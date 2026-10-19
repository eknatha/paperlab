/* PaperLab tool: Mass Batch — one operation over hundreds of files, offline.
   Engine: js/batch/engine.js · Sinks: js/batch/sink.js · Operations: js/ops.js + js/ocr/searchable.js */
(function (PL) {
  const B = PL.batch;
  const GROUPS = ['Optimize', 'Pages', 'Mark', 'Read', 'Fix', 'Books & comics'];

  PL.register('batch', function (root) {
    root.classList.add('batch');
    const ops = Object.values(PL.ops).filter(o => o.id);
    let items = [], ctl = null, running = false, lastDir = null, runNo = 0, lastRunOutputs = [];
    const seen = new Set();

    /* ── operation picker ── */
    const pick = PL.el('div', 'ctl');
    const opField = PL.el('div', 'field grow');
    opField.innerHTML = '<label for="b_op">What should happen to every file?</label>';
    const opSel = PL.el('select'); opSel.id = 'b_op';
    GROUPS.forEach(g => {
      const og = PL.el('optgroup'); og.label = g;
      ops.filter(o => o.group === g).forEach(o => { const e = PL.el('option'); e.value = o.id; e.textContent = o.label; og.appendChild(e); });
      if (og.children.length) opSel.appendChild(og);
    });
    opSel.value = 'compress';
    opField.appendChild(opSel); pick.appendChild(opField); root.appendChild(pick);
    const optHost = PL.el('div'); root.appendChild(optHost);
    const opNote = PL.el('div', 'note'); opNote.style.display = 'none'; root.appendChild(opNote);
    let F = null, op = null;

    function setOp() {
      op = PL.ops[opSel.value];
      F = PL.buildFields(op.fields);
      optHost.innerHTML = ''; optHost.appendChild(F.el);
      opNote.style.display = op.note ? '' : 'none'; opNote.textContent = op.note || '';
      conc.querySelector('option[value="0"]').textContent = 'Auto (' + B.autoConcurrency(op) + ')';
      const W = { pdf: 'PDFs', image: 'images (JPG / PNG / WebP)', epub: 'EPUB e-books', cbz: 'CBZ / ZIP comics' };
      dropHint.textContent = op.accepts.map(k => W[k]).join(' and ') + (PL.env.mobile ? '' : ' · folders welcome');
      refreshApplicable(); renderSummary();
    }

    /* ── input area ── */
    const dz = PL.el('div', 'drop', 'Drop <b>PDFs or whole folders</b> here');
    const dropHint = PL.el('div', 'hint'); dz.appendChild(dropHint);
    const pickRow = PL.el('div', 'actions');
    const addFiles = PL.el('button', 'btn ghost', 'Add files'); addFiles.type = 'button';
    const addDir = PL.el('button', 'btn ghost', 'Add folder'); addDir.type = 'button';
    pickRow.appendChild(addFiles);
    const fileInp = PL.el('input'); fileInp.type = 'file'; fileInp.multiple = true; fileInp.style.display = 'none';
    fileInp.accept = '.pdf,application/pdf,image/jpeg,image/png,image/webp,.epub,.cbz,.zip';
    const dirInp = PL.el('input'); dirInp.type = 'file'; dirInp.multiple = true; dirInp.style.display = 'none';
    dirInp.setAttribute('webkitdirectory', ''); dirInp.setAttribute('directory', '');
    const dirOk = 'webkitdirectory' in dirInp && !PL.env.mobile;
    if (dirOk) pickRow.appendChild(addDir);
    pickRow.append(fileInp, dirInp);
    root.append(dz, pickRow);
    addFiles.onclick = () => fileInp.click();
    addDir.onclick = () => dirInp.click();
    fileInp.onchange = () => { addMany([...fileInp.files].map(f => ({ file: f, path: f.name }))); fileInp.value = ''; };
    dirInp.onchange = () => { addMany([...dirInp.files].map(f => ({ file: f, path: f.webkitRelativePath || f.name }))); dirInp.value = ''; };
    dz.onclick = () => fileInp.click();
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = async e => {
      e.preventDefault(); dz.classList.remove('drag');
      if (running) return;
      sum.textContent = 'Reading dropped files…';
      try { addMany(await B.collectDrop(e.dataTransfer)); } catch (err) { sum.textContent = 'Could not read the drop: ' + err.message; }
    };

    const sumRow = PL.el('div', 'sumrow');
    const sum = PL.el('span', 'sum'); const clear = PL.el('button', 'btn ghost sm', 'Clear'); clear.type = 'button';
    sumRow.append(sum, clear); root.appendChild(sumRow);
    clear.onclick = () => { if (running) return; items = []; seen.clear(); list.innerHTML = ''; renderSummary(); showResults([]); };

    function addMany(entries) {
      let ignored = 0;
      entries.forEach(({ file, path }) => {
        if (!B.matches(file.name, ['pdf', 'image', 'epub', 'cbz'])) { ignored++; return; }
        const key = path + '|' + file.size + '|' + file.lastModified;
        if (seen.has(key)) return;
        seen.add(key);
        const it = B.makeItem(file, path); items.push(it); list.appendChild(rowFor(it));
      });
      refreshApplicable(); renderSummary(ignored);
    }
    /* items the chosen operation cannot take are parked as "skipped", not failed */
    function refreshApplicable() {
      items.forEach(it => {
        const ok = B.matches(it.name, op.accepts);
        if (!ok && it.state === 'queued') { it.state = 'skipped'; it.msg = 'not used by “' + op.label + '”'; paint(it); }
        else if (ok && it.state === 'skipped') { it.state = 'queued'; it.msg = ''; paint(it); }
      });
    }
    function renderSummary(ignored) {
      const act = items.filter(i => i.state !== 'skipped');
      const sk = items.length - act.length, bytes = act.reduce((n, i) => n + i.size, 0);
      sum.textContent = items.length
        ? act.length + ' file' + (act.length === 1 ? '' : 's') + ' · ' + PL.fmtBytes(bytes) +
          (sk ? ' · ' + sk + ' not applicable' : '') + (ignored ? ' · ' + ignored + ' ignored (unsupported type)' : '')
        : (ignored ? ignored + ' ignored (unsupported type)' : 'No files yet');
      start.disabled = running || !act.length; clear.disabled = running || !items.length;
    }

    /* ── advanced ── */
    const adv = PL.el('details', 'adv');
    adv.innerHTML = '<summary>Advanced</summary>';
    const advBody = PL.el('div', 'ctl');
    const conc = PL.el('select'); conc.id = 'b_conc';
    [['0', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6'], ['8', '8']].forEach(([v, l]) => { const o = PL.el('option'); o.value = v; o.textContent = l; conc.appendChild(o); });
    const outSel = PL.el('select'); outSel.id = 'b_out';
    outSel.innerHTML = '<option value="zip">ZIP file(s) — works everywhere</option>';
    if (PL.env.dirPicker) outSel.innerHTML += '<option value="dir">Folder on this computer — no size limit</option>';
    const partSel = PL.el('select'); partSel.id = 'b_part';
    [['0', 'Auto (' + (PL.env.mobile ? 80 : 400) + ' MB)'], ['50', '50 MB'], ['100', '100 MB'], ['250', '250 MB'], ['500', '500 MB'], ['1000', '1 GB']].forEach(([v, l]) => { const o = PL.el('option'); o.value = v; o.textContent = l; partSel.appendChild(o); });
    const repBox = PL.el('input'); repBox.type = 'checkbox'; repBox.checked = true; repBox.id = 'b_rep';
    const mk = (label, el, cls) => { const d = PL.el('div', 'field' + (cls ? ' ' + cls : '')); const l = PL.el('label'); l.textContent = label; l.htmlFor = el.id; if (cls === 'check') d.append(el, l); else d.append(l, el); return d; };
    advBody.append(mk('Files in parallel', conc), mk('Save results as', outSel), mk('Split ZIP every', partSel), mk('Include paperlab-report.csv', repBox, 'check'));
    adv.appendChild(advBody); root.appendChild(adv);
    outSel.onchange = () => { partSel.parentNode.style.display = outSel.value === 'zip' ? '' : 'none'; };

    /* ── controls ── */
    const actions = PL.el('div', 'actions');
    const start = PL.el('button', 'btn', 'Start batch'); start.disabled = true;
    const pause = PL.el('button', 'btn ghost', 'Pause'); pause.style.display = 'none';
    const cancel = PL.el('button', 'btn ghost', 'Cancel'); cancel.style.display = 'none';
    actions.append(start, pause, cancel); root.appendChild(actions);
    if (PL.env.mobile) root.appendChild(PL.el('div', 'note', 'On phones results download as ZIP files. Keep this tab open and the screen on while a batch runs — browsers pause background tabs.'));

    /* ── progress ── */
    const prog = PL.el('div', 'bprog'); prog.style.display = 'none';
    prog.innerHTML = '<div class="bar"><i></i></div><div class="bstat"></div><div class="bstat2"></div>';
    root.appendChild(prog);
    const barI = prog.querySelector('i'), stat = prog.querySelector('.bstat'), stat2 = prog.querySelector('.bstat2');

    const secs = s => s == null ? '…' : s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h';
    function paintStats(st) {
      prog.style.display = '';
      barI.style.width = Math.round(st.frac * 100) + '%';
      stat.textContent = (st.ok + st.failed) + ' / ' + st.total + ' done' + (st.failed ? ' · ' + st.failed + ' failed' : '') +
        (st.active ? ' · ' + st.active + ' running' : '') + (ctl && ctl.paused ? ' · PAUSED' : '') +
        (running && st.eta != null ? ' · ~' + secs(st.eta) + ' left' : '');
      const saved = st.inB ? Math.round((1 - st.outB / st.inB) * 100) : 0;
      stat2.textContent = 'elapsed ' + secs(st.elapsed) + (st.inB ? ' · ' + PL.fmtBytes(st.inB) + ' → ' + PL.fmtBytes(st.outB) + (op.id === 'compress' ? ' (' + (saved >= 0 ? '−' : '+') + Math.abs(saved) + '%)' : '') : '');
    }

    /* ── list ── */
    const flt = PL.el('label', 'flt'); flt.innerHTML = '<input type="checkbox" id="b_onlyfail"> show only failed';
    root.appendChild(flt);
    const list = PL.el('ul', 'blist'); root.appendChild(list);
    const ICON = { queued: '·', running: '◔', done: '✓', failed: '✕', skipped: '–', cancelled: '⏸' };
    function rowFor(it) {
      const li = PL.el('li', 'brow st-' + it.state);
      li.innerHTML = '<span class="ic"></span><span class="nm"></span><span class="mt"></span><span class="msg"></span><i class="pb"></i>';
      li.querySelector('.nm').textContent = it.path; li.querySelector('.nm').title = it.path;
      li.querySelector('.mt').textContent = PL.fmtBytes(it.size);
      it._li = li; paint(it); return li;
    }
    function paint(it) {
      const li = it._li; if (!li) return;
      li.className = 'brow st-' + it.state;
      li.querySelector('.ic').textContent = ICON[it.state] || '·';
      li.querySelector('.msg').textContent = it.state === 'failed' ? it.error : (it.msg || '');
      li.querySelector('.pb').style.width = it.state === 'running' ? Math.round((it.progress || 0) * 100) + '%' : '0';
    }
    flt.querySelector('input').onchange = e => list.classList.toggle('only-failed', e.target.checked);
    let dirty = new Set(), raf = 0;
    const queuePaint = it => { dirty.add(it); if (!raf) raf = requestAnimationFrame(() => { raf = 0; dirty.forEach(paint); dirty = new Set(); }); };

    /* ── results ── */
    const res = PL.el('div', 'out'); root.appendChild(res);
    const retry = PL.el('button', 'btn', 'Retry failed files'); retry.style.display = 'none';
    root.appendChild(retry);

    function showResults(links, extra) {
      res.innerHTML = '';
      if (extra) res.appendChild(PL.el('div', 'log ok', extra));
      links.forEach(l => res.appendChild(l));
    }

    const guard = e => { if (running) { e.preventDefault(); e.returnValue = ''; } };
    PL.busy = () => running;
    PL.cleanup = () => { if (ctl) ctl.cancel(); PL.ocr && PL.ocr.shutdown(); window.removeEventListener('beforeunload', guard); };

    /* ── run ── */
    async function launch(only) {
      if (running) return;
      const mode = outSel.value, useDir = mode === 'dir' && PL.env.dirPicker;
      let sink;
      if (useDir) {
        if (!lastDir || only !== 'retry') {
          try { lastDir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
          catch (e) { return; }                                   // user dismissed the picker
        }
        sink = new B.DirSink(lastDir);
      } else {
        const mb = +partSel.value;
        sink = new B.ZipSink({ partLimit: mb ? mb * 1048576 : undefined, prefix: 'paperlab-batch' + (runNo ? '-run' + (runNo + 1) : '') });
      }
      runNo++;
      const opts = { ...F.values() };
      if (op.heavy) opts.workers = PL.ocr.defaultWorkers();
      const first = items.filter(i => i.state === 'queued' || i.state === 'cancelled');
      if (!first.length) return;
      running = true; lastRunOutputs = [];
      window.addEventListener('beforeunload', guard);
      [start, addFiles, addDir, clear, retry, opSel, outSel, partSel, conc, repBox].forEach(e => e.disabled = true);
      F.el.querySelectorAll('input,select').forEach(e => e.disabled = true);
      start.style.display = 'none'; pause.style.display = ''; cancel.style.display = ''; pause.textContent = 'Pause';
      retry.style.display = 'none'; showResults([]);
      const nConc = +conc.value || B.autoConcurrency(op);
      const mem = Math.min(400, Math.max(60, PL.env.mem * 40)) * 1048576;
      ctl = B.run({ items, op, opts, sink, concurrency: nConc, maxBytes: mem, onUpdate: queuePaint, onStats: paintStats });
      const st = await ctl.done;
      let links = [], msg = '';
      try {
        if (repBox.checked && sink.count) await sink.add('paperlab-report.csv', new TextEncoder().encode(B.reportCsv(items.filter(i => i.state !== 'skipped'))));
        const parts = await sink.finish();
        if (useDir) msg = 'Saved ' + sink.count + ' file' + (sink.count === 1 ? '' : 's') + ' to the folder you chose.';
        else {
          parts.forEach(p => { const a = PL.download(p.blob, p.name); a.querySelector('.nm').textContent = p.name + ' · ' + p.files + ' files · ' + PL.fmtBytes(p.size); links.push(a); });
          msg = parts.length > 1 ? 'Results are split into ' + parts.length + ' ZIP parts — download each one.' : (parts.length ? '' : 'Nothing was produced.');
        }
      } catch (e) { msg = 'Could not finalise output: ' + PL.friendlyError(e); }
      const failed = items.filter(i => i.state === 'failed');
      if (failed.length) {
        const csv = new Blob(['source,error\r\n' + failed.map(i => '"' + i.path.replace(/"/g, '""') + '","' + i.error.replace(/"/g, '""') + '"').join('\r\n')], { type: 'text/csv' });
        const a = PL.download(csv, 'paperlab-failed.csv', 'text/csv'); links.push(a);
        retry.style.display = '';
      }
      showResults(links, (st.cancelled ? 'Stopped — ' + st.cancelled + ' file(s) not processed (press Start to continue). ' : '') + msg);
      if (op.heavy) PL.ocr.shutdown();
      running = false; ctl = null;
      window.removeEventListener('beforeunload', guard);
      [addFiles, addDir, clear, retry, opSel, outSel, partSel, conc, repBox].forEach(e => e.disabled = false);
      F.el.querySelectorAll('input,select').forEach(e => e.disabled = false);
      start.style.display = ''; pause.style.display = 'none'; cancel.style.display = 'none';
      start.textContent = items.some(i => i.state === 'cancelled') ? 'Continue batch' : 'Start batch';
      renderSummary();
    }
    start.onclick = () => launch();
    retry.onclick = () => { items.forEach(i => { if (i.state === 'failed') { i.state = 'queued'; i.error = ''; paint(i); } }); launch('retry'); };
    pause.onclick = () => { if (!ctl) return; if (ctl.paused) { ctl.resume(); pause.textContent = 'Pause'; } else { ctl.pause(); pause.textContent = 'Resume'; } };
    cancel.onclick = () => { if (ctl) ctl.cancel(); };
    opSel.onchange = setOp;
    outSel.onchange();
    setOp();
  });
})(window.PaperLab);
