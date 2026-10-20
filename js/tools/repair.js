/* Patram tool: Repair a damaged PDF.  Engine: js/repair/engine.js (shared with Mass Batch). */
(function (PL) {
  PL.register('repair', function (root) {
    let file = null, running = false, ac = null;

    root.appendChild(PL.dropZone(fs => setFile(fs[0]), '.pdf,application/pdf,*/*', false));
    const info = PL.el('div', 'log'); root.appendChild(info);

    const opts = PL.el('div', 'ctl');
    opts.innerHTML = '<div class="field check"><input type="checkbox" id="r_img" checked><label for="r_img">If some pages cannot be read, redraw them as images (text becomes non-selectable)</label></div>';
    root.appendChild(opts);
    root.appendChild(PL.el('div', 'note', 'Fixes files that will not open, show “damaged / cannot be repaired”, were cut off mid-download, or have a broken index. Patram rebuilds the internal structure and keeps every page it can still read. Bytes that are physically missing cannot be invented. Password-protected files are not touched. Many files? Use <b>Mass Batch → Repair damaged PDF</b>.'));

    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Repair'); go.disabled = true;
    const stop = PL.el('button', 'btn ghost', 'Cancel'); stop.style.display = 'none';
    actions.append(go, stop); root.appendChild(actions);
    const bar = PL.el('div', 'bar'); bar.innerHTML = '<i></i>'; bar.style.display = 'none'; root.appendChild(bar);
    const log = PL.logger(root);
    const res = PL.el('div', 'result'); res.style.display = 'none'; root.appendChild(res);
    const out = PL.el('div', 'out'); root.appendChild(out);
    const setBar = f => { bar.style.display = 'block'; bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; };

    function setFile(f) {
      if (!f) return;
      file = f; out.innerHTML = ''; res.style.display = 'none'; bar.style.display = 'none';
      info.textContent = f.name + ' · ' + PL.fmtBytes(f.size);
      go.disabled = running;
    }
    const STRAT = { light: 'Light clean-up', rebuild: 'Rebuilt structure', salvage: 'Page-by-page salvage', images: 'Redrawn as images' };

    go.onclick = async () => {
      running = true; ac = new AbortController(); go.disabled = true; stop.style.display = ''; out.innerHTML = ''; res.style.display = 'none';
      PL.busy = () => running; PL.cleanup = () => ac.abort();
      const t0 = performance.now();
      try {
        log.set('Reading file…');
        const buf = new Uint8Array(await PL.readArrayBuffer(file));
        const r = await PL.repair.repair(buf, { images: root.querySelector('#r_img').checked }, { signal: ac.signal, name: file.name, progress: (f, m) => { setBar(f); log.set('Repairing — ' + m + '…'); } });
        setBar(1);
        const rp = r.report, partial = (rp.total && rp.recovered < rp.total) || rp.damaged > 0;
        res.style.display = ''; res.className = 'result ' + (partial || rp.images ? 'warn' : 'good');
        res.innerHTML = '<div class="rsz"><b class="to"></b></div><div class="rnote"></div><ul class="issues"></ul>';
        res.querySelector('.to').textContent = rp.recovered + (rp.total && rp.total !== rp.recovered ? ' of ' + rp.total : '') + ' page' + (rp.recovered === 1 ? '' : 's') + ' recovered';
        res.querySelector('.rnote').textContent = (STRAT[rp.strategy] || rp.strategy) + (rp.damaged ? ' · ' + rp.damaged + ' page' + (rp.damaged === 1 ? '' : 's') + ' may show damage' : '') + ' · ' + PL.fmtBytes(file.size) + ' → ' + PL.fmtBytes(r.bytes.length);
        const ul = res.querySelector('.issues');
        rp.issues.forEach(t => { const li = PL.el('li'); li.textContent = t; ul.appendChild(li); });
        out.appendChild(PL.download(r.bytes, file.name.replace(/\.[^.]*$/, '') + '-repaired.pdf'));
        log.set((partial || rp.images ? 'Finished with a warning' : 'Done') + ' in ' + Math.round((performance.now() - t0) / 1000) + ' s.', partial || rp.images ? 'err' : 'ok');
      } catch (e) {
        log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Could not repair: ' + PL.friendlyError(e), 'err');
      }
      running = false; stop.style.display = 'none'; go.disabled = !file; PL.busy = null; PL.cleanup = null;
    };
    stop.onclick = () => { if (ac) ac.abort(); log.set('Cancelling…'); };
  });
})(window.PaperLab);
