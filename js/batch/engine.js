/* Patram — Mass Batch engine.
   Runs ONE operation over many files with:
     • bounded parallelism + an in-flight-bytes budget (RAM is the real limit, not file count)
     • per-file failure isolation (a corrupt / encrypted PDF never stops the run)
     • pause / resume / cancel, retry-failed, ETA
     • results streamed to a sink (ZIP parts or a real folder)
   File reading is lazy: a File is only read into memory when its turn comes. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const B = PL.batch = PL.batch || {};
  let seq = 0;

  /* ───────── collecting files (drop, picker, folders) ───────── */
  const EXT = { pdf: /\.pdf$/i, image: /\.(jpe?g|png|webp)$/i, epub: /\.epub$/i, cbz: /\.(cbz|zip)$/i };
  B.matches = function (name, accepts) { return accepts.some(k => EXT[k].test(name)); };

  B.makeItem = function (file, path) {
    return { id: ++seq, file, name: file.name, path: path || file.webkitRelativePath || file.name, size: file.size,
             state: 'queued', progress: 0, msg: '', error: '', outSize: 0, outs: [] };
  };

  /* Read a DataTransfer, descending into dropped folders. */
  B.collectDrop = async function (dt) {
    const out = [];
    const entries = [];
    if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
      for (const it of dt.items) { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) entries.push(en); }
    }
    if (!entries.length) return [...(dt.files || [])].map(f => ({ file: f, path: f.name }));
    const readAll = r => new Promise((res, rej) => {
      const acc = [];
      (function next() { r.readEntries(b => { if (!b.length) res(acc); else { acc.push(...b); next(); } }, rej); })();
    });
    async function walk(en, prefix) {
      if (en.isFile) {
        const f = await new Promise((res, rej) => en.file(res, rej));
        out.push({ file: f, path: prefix + f.name });
      } else if (en.isDirectory) {
        const kids = await readAll(en.createReader());
        for (const k of kids) await walk(k, prefix + en.name + '/');
      }
    }
    for (const en of entries) await walk(en, '');
    return out;
  };

  /* ───────── naming ───────── */
  function splitPath(p) {
    const s = p.lastIndexOf('/');
    return { dir: p.slice(0, s + 1), file: p.slice(s + 1) };
  }
  function stemOf(name) { const d = name.lastIndexOf('.'); return d > 0 ? name.slice(0, d) : name; }
  B.outPath = function (item, suffix, ext) {
    const { dir, file } = splitPath(item.path);
    return dir + stemOf(file) + (suffix || '') + '.' + ext;
  };

  /* ───────── the runner ───────── */
  /* cfg: { items, op, opts, sink, concurrency, maxBytes, signal, onUpdate(item), onStats(stats), reportCsv }
     returns a controller { done:Promise, pause(), resume(), cancel(), paused } */
  B.run = function (cfg) {
    const ac = new AbortController();
    const ctl = { paused: false, signal: ac.signal };
    const op = cfg.op, items = cfg.items;
    const todo = items.filter(it => it.state === 'queued' || it.state === 'cancelled');
    todo.forEach(it => { it.state = 'queued'; it.progress = 0; it.error = ''; it.msg = ''; });
    const t0 = performance.now();
    let running = 0, runningBytes = 0, idx = 0, finished = false;
    const maxBytes = cfg.maxBytes || (PL.env.mobile ? 60 : 300) * 1048576;

    const bytesTotal = todo.reduce((n, it) => n + it.size, 0);
    function stats() {
      let doneB = 0, ok = 0, failed = 0, skipped = 0, inB = 0, outB = 0, active = 0;
      todo.forEach(it => {
        if (it.state === 'done') { ok++; doneB += it.size; inB += it.size; outB += it.outSize; if (it.skipped) skipped++; }
        else if (it.state === 'failed') { failed++; doneB += it.size; }
        else if (it.state === 'running') { active++; doneB += it.size * (it.progress || 0); }
      });
      const el = (performance.now() - t0) / 1000;
      const frac = bytesTotal ? doneB / bytesTotal : 1;
      const eta = frac > 0.02 && frac < 1 ? el * (1 - frac) / frac : null;
      const cancelled = todo.filter(i => i.state === 'cancelled').length;
      return { total: todo.length, ok, failed, skipped, active, cancelled, frac, elapsed: el, eta, inB, outB,
               queued: todo.length - ok - failed - active - cancelled };
    }
    const emit = it => { if (cfg.onUpdate) cfg.onUpdate(it); if (cfg.onStats) cfg.onStats(stats()); };

    let wake = null;
    async function lockScreen() {
      try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; }
    }
    const onVis = () => { if (document.visibilityState === 'visible' && !finished) lockScreen(); };

    /* ── per-file job ── */
    async function job(it) {
      it.state = 'running'; it.t0 = performance.now(); emit(it);
      try {
        const buf = new Uint8Array(await it.file.arrayBuffer());
        if (!buf.length) throw new Error('Empty file (0 bytes)');
        const kind = op.anyInput ? 'pdf' : PL.sniff(buf);       // anyInput: the op diagnoses damaged / headerless files itself
        const zipOk = kind === 'zip' && (op.accepts.indexOf('epub') >= 0 || op.accepts.indexOf('cbz') >= 0);
        if (!kind || (!zipOk && op.accepts.indexOf(kind === 'jpg' || kind === 'png' || kind === 'webp' ? 'image' : kind) < 0)) {
          throw new Error(kind ? 'Unsupported for this operation (' + kind.toUpperCase() + ')' : 'Not a valid ' + (op.accepts.indexOf('epub') >= 0 ? 'EPUB' : op.accepts.indexOf('cbz') >= 0 ? 'CBZ / ZIP' : 'PDF or image') + ' (wrong file type or corrupted)');
        }
        const ctx = {
          signal: ac.signal, name: it.name,
          progress: (f, m) => { it.progress = Math.min(0.99, f || 0); if (m) it.msg = m; emit(it); }
        };
        const r = await op.run(buf, cfg.opts, ctx);
        if (ac.signal.aborted) { const e = new Error('Cancelled'); e.name = 'AbortError'; throw e; }
        const ext = r.ext || op.ext;
        const written = [];
        written.push(await cfg.sink.add(B.outPath(it, op.suffix, ext), r.bytes));
        for (const x of (r.extras || [])) written.push(await cfg.sink.add(B.outPath(it, x.suffix != null ? x.suffix : op.suffix, x.ext), x.bytes));
        it.outs = written; it.outSize = r.bytes.length; it.skipped = !!r.skipped;
        it.msg = r.note || ''; it.state = 'done'; it.progress = 1;
      } catch (e) {
        if (e && e.name === 'AbortError') { it.state = 'cancelled'; it.msg = 'cancelled'; }
        else { it.state = 'failed'; it.error = PL.friendlyError(e); }
      }
      it.t1 = performance.now();
    }

    /* ── group job (merge: many → one) ── */
    async function groupJob(members, name) {
      members.forEach(m => { m.state = 'running'; m.progress = 0; emit(m); });
      try {
        const bad = new Set();
        const ctx = {
          signal: ac.signal,
          progress: (f, msg) => { members.forEach(m => { m.progress = Math.min(0.99, f); m.msg = msg || ''; }); emit(members[0]); },
          onBad: (f, e) => { const m = members.find(x => x.file === f.file); if (m) { bad.add(m); m.state = 'failed'; m.error = PL.friendlyError(e); } }
        };
        const r = await op.runGroup(members.map(m => ({ file: m.file, path: m.path })), cfg.opts, ctx);
        const path = await cfg.sink.add(name, r.bytes);
        members.forEach(m => {
          if (bad.has(m)) return;
          m.state = 'done'; m.progress = 1; m.outs = [path]; m.outSize = Math.round(r.bytes.length / members.length); m.msg = '→ ' + path;
        });
      } catch (e) {
        members.forEach(m => {
          if (m.state === 'failed') return;
          if (e && e.name === 'AbortError') { m.state = 'cancelled'; m.msg = 'cancelled'; }
          else { m.state = 'failed'; m.error = PL.friendlyError(e); }
        });
      }
      members.forEach(m => emit(m));
    }

    /* ── scheduler ── */
    ctl.done = new Promise(resolve => {
      const finish = async () => {
        if (finished) return; finished = true;
        document.removeEventListener('visibilitychange', onVis);
        try { if (wake) await wake.release(); } catch (e) { /* ignore */ }
        resolve(stats());
      };
      ctl._pump = () => {
        if (finished) return;
        if (op.kind === 'group') return;
        while (!ac.signal.aborted && !ctl.paused && idx < todo.length && running < cfg.concurrency &&
               (running === 0 || runningBytes + todo[idx].size <= maxBytes)) {
          const it = todo[idx++]; running++; runningBytes += it.size;
          job(it).then(() => { running--; runningBytes -= it.size; emit(it); ctl._pump(); });
        }
        if (running === 0 && (idx >= todo.length || ac.signal.aborted)) {
          // everything we did not start is "cancelled" (resumable)
          todo.forEach(it => { if (it.state === 'queued' && ac.signal.aborted) it.state = 'cancelled'; });
          finish();
        }
      };
      ctl._finish = finish;
      lockScreen(); document.addEventListener('visibilitychange', onVis);

      if (op.kind === 'group') {
        (async () => {
          let list = todo.slice();
          if (cfg.opts.sort !== 'none') list.sort((a, b) => PL.natCompare(a.path, b.path));
          const per = +cfg.opts.per || list.length || 1;
          const groups = []; for (let i = 0; i < list.length; i += per) groups.push(list.slice(i, i + per));
          for (let g = 0; g < groups.length; g++) {
            while (ctl.paused && !ac.signal.aborted) await new Promise(r => setTimeout(r, 150));
            if (ac.signal.aborted) break;
            const name = groups.length === 1 ? 'merged.pdf' : 'merged-' + String(g + 1).padStart(3, '0') + '.pdf';
            await groupJob(groups[g], name);
          }
          list.forEach(it => { if (it.state === 'queued') it.state = 'cancelled'; });
          finish();
        })();
      } else {
        ctl._pump();
      }
    });

    ctl.pause = () => { ctl.paused = true; if (cfg.onStats) cfg.onStats(stats()); };
    ctl.resume = () => { ctl.paused = false; ctl._pump(); if (cfg.onStats) cfg.onStats(stats()); };
    ctl.cancel = () => { ac.abort(); ctl.paused = false; ctl._pump(); };
    ctl.stats = stats;
    return ctl;
  };

  /* ───────── helpers for the UI ───────── */
  B.autoConcurrency = function (op) {
    const e = PL.env;
    if (op.heavy) return e.mobile ? 1 : 2;                        // OCR: pages already fan out inside the engine
    if (op.id === 'compress') return e.mobile ? 1 : Math.max(1, Math.min(3, e.cores - 1));
    return e.mobile ? 2 : Math.max(2, Math.min(4, e.cores - 1));
  };

  B.reportCsv = function (items) {
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const rows = [['source', 'status', 'output', 'input_bytes', 'output_bytes', 'note_or_error']];
    items.forEach(it => rows.push([it.path, it.state, (it.outs || []).join(' | '), it.size, it.outSize || '', it.error || it.msg || '']));
    return rows.map(r => r.map(q).join(',')).join('\r\n');
  };
})(window.PaperLab);
