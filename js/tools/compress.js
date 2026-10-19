/* PaperLab tool: Compress to a target size — 100 KB / 200 KB / 300 KB / 1 MB / custom / manual.
   Engine: js/compress/engine.js (shared with Mass Batch). */
(function (PL) {
  PL.register('compress', function (root) {
    const C = PL.compress;
    let file = null, running = false, ac = null, mode = '300';

    const dz = PL.dropZone(fs => { setFile(fs.find(f => /\.pdf$/i.test(f.name)) || fs[0]); }, '.pdf,application/pdf', false);
    root.appendChild(dz);
    const info = PL.el('div', 'log'); root.appendChild(info);

    /* target chips */
    const lab = PL.el('div', 'chips-label', 'Target size'); root.appendChild(lab);
    const chips = PL.el('div', 'chips'); chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'Target size');
    const CHIPS = C.TARGETS.concat([['custom', 'Custom'], ['manual', 'Manual']]);
    CHIPS.forEach(([v, t]) => {
      const b = PL.el('button', 'chip', t); b.type = 'button'; b.dataset.v = v;
      b.setAttribute('role', 'radio'); b.onclick = () => setMode(v);
      chips.appendChild(b);
    });
    root.appendChild(chips);

    const ctl = PL.el('div', 'ctl');
    ctl.innerHTML =
      '<div class="field" id="c_custom"><label for="c_kb">Custom target (KB)</label><input id="c_kb" type="number" inputmode="decimal" min="10" value="150"></div>' +
      '<div class="field" id="c_q"><label for="c_qs">Strength</label><select id="c_qs"><option value="0.6">Balanced</option><option value="0.4">Smaller</option><option value="0.8">Light</option></select></div>' +
      '<div class="field" id="c_d"><label for="c_dpi">Resolution</label><select id="c_dpi"><option value="1.3">Standard</option><option value="1">Low</option><option value="1.8">High</option></select></div>';
    root.appendChild(ctl);
    const opts = PL.el('div', 'ctl');
    opts.innerHTML =
      '<div class="field check" id="c_rw"><input type="checkbox" id="c_raster" checked><label for="c_raster">If needed, flatten pages to images (text stops being selectable)</label></div>' +
      '<div class="field check" id="c_gw"><input type="checkbox" id="c_gray" checked><label for="c_gray">If needed, convert to grayscale</label></div>';
    root.appendChild(opts);
    const $ = id => root.querySelector('#' + id);

    root.appendChild(PL.el('div', 'note', 'PaperLab finds the best quality that fits your size. Images are re-encoded first, so text stays selectable; flattening pages happens only if that is not enough and you allow it. Have many files? Use <b>Mass Batch</b> with the same options.'));

    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Compress'); go.disabled = true;
    const stop = PL.el('button', 'btn ghost', 'Cancel'); stop.style.display = 'none';
    actions.append(go, stop); root.appendChild(actions);
    const bar = PL.el('div', 'bar'); bar.innerHTML = '<i></i>'; bar.style.display = 'none'; root.appendChild(bar);
    const log = PL.logger(root);
    const res = PL.el('div', 'result'); res.style.display = 'none'; root.appendChild(res);
    const out = PL.el('div', 'out'); root.appendChild(out);

    function setMode(v) {
      mode = v;
      chips.querySelectorAll('.chip').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      $('c_custom').style.display = v === 'custom' ? '' : 'none';
      $('c_q').style.display = $('c_d').style.display = v === 'manual' ? '' : 'none';
      $('c_rw').style.display = $('c_gw').style.display = v === 'manual' ? 'none' : '';
    }
    function setFile(f) {
      if (!f) return;
      file = f; out.innerHTML = ''; res.style.display = 'none'; bar.style.display = 'none';
      info.textContent = f.name + ' · ' + PL.fmtBytes(f.size);
      go.disabled = running;
    }
    const setBar = f => { bar.style.display = 'block'; bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; };

    go.onclick = async () => {
      running = true; ac = new AbortController(); go.disabled = true; stop.style.display = ''; out.innerHTML = ''; res.style.display = 'none';
      PL.busy = () => running; PL.cleanup = () => ac.abort();
      const o = { mode, custom: $('c_kb').value, q: $('c_qs').value, dpi: $('c_dpi').value, raster: $('c_raster').checked, gray: $('c_gray').checked, keep: true };
      const t0 = performance.now();
      try {
        C.targetBytes(o);                                                  // validates custom input before any work
        log.set('Reading file…');
        const buf = await PL.readArrayBuffer(file);
        const r = await PL.ops.compress.run(buf, o, { signal: ac.signal, name: file.name, progress: (f, m) => { setBar(f); log.set('Compressing — ' + m + '…'); } });
        setBar(1);
        const target = C.targetBytes(o), a = file.size, b = r.bytes.length;
        const stem = file.name.replace(/\.pdf$/i, '');
        res.style.display = '';
        const pct = a ? Math.round((1 - b / a) * 100) : 0;
        const good = target ? r.reached : b < a;
        res.className = 'result ' + (good ? 'good' : 'warn');
        res.innerHTML = '<div class="rsz"><span class="from"></span><i>→</i><b class="to"></b></div><div class="rnote"></div>';
        res.querySelector('.from').textContent = PL.fmtBytes(a);
        res.querySelector('.to').textContent = PL.fmtBytes(b) + (b < a ? '  (−' + pct + '%)' : '');
        res.querySelector('.rnote').textContent = (r.note || '').replace(/^\S+ \S+ → \S+ \S+\s*/, '') || (b < a ? 'Done.' : 'No reduction possible.');   // sizes are already shown above
        out.appendChild(PL.download(r.bytes, stem + '-compressed.pdf'));
        log.set((good ? 'Done' : 'Finished with a warning') + ' in ' + Math.round((performance.now() - t0) / 1000) + ' s.', good ? 'ok' : 'err');
      } catch (e) {
        log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Failed: ' + PL.friendlyError(e), 'err');
      }
      running = false; stop.style.display = 'none'; go.disabled = !file; PL.busy = null; PL.cleanup = null;
    };
    stop.onclick = () => { if (ac) ac.abort(); log.set('Cancelling…'); };
    setMode('300');
  });
})(window.PaperLab);
