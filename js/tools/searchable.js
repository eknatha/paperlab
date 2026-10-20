/* Patram tool: Searchable — OCR scanned PDFs / images into searchable PDFs (Tesseract.js, local) */
(function (PL) {
  PL.register('searchable', function (root) {
    const op = PL.ops.searchable;
    let files = [], running = false, ac = null;
    const list = PL.el('ul', 'files');
    root.appendChild(PL.dropZone(add, '.pdf,application/pdf,image/jpeg,image/png,image/webp', true));
    root.appendChild(list);

    const F = PL.buildFields(op.fields);
    root.appendChild(F.el);
    const combineBox = PL.el('div', 'field check');
    combineBox.innerHTML = '<input type="checkbox" id="f_combine" checked><label for="f_combine">Combine images into one PDF</label>';
    F.el.appendChild(combineBox);
    root.appendChild(PL.el('div', 'note', 'Scans never leave this device. The original page stays untouched — an invisible text layer is added on top, so file size barely changes. First run loads the OCR engine (~4 MB) from this site; after that it works offline. Handwriting and low-quality scans recognise poorly.'));

    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Make searchable'); go.disabled = true;
    const stop = PL.el('button', 'btn ghost', 'Cancel'); stop.style.display = 'none';
    actions.append(go, stop); root.appendChild(actions);
    const bar = PL.el('div', 'bar'); bar.innerHTML = '<i></i>'; bar.style.display = 'none'; root.appendChild(bar);
    const log = PL.logger(root);
    const out = PL.el('div', 'out'); root.appendChild(out);
    const prev = PL.el('details', 'prev'); prev.style.display = 'none';
    prev.innerHTML = '<summary>Recognised text preview</summary><textarea readonly rows="10" aria-label="Recognised text"></textarea><div class="actions"><button class="btn ghost" type="button">Copy text</button></div>';
    root.appendChild(prev);
    prev.querySelector('button').onclick = () => { const t = prev.querySelector('textarea'); t.select(); (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.resolve(document.execCommand('copy'))).then(() => log.set('Text copied.', 'ok'), () => {}); };

    function add(fs) {
      fs.forEach(f => { if (PL.ocr && /\.(pdf|jpe?g|png|webp)$/i.test(f.name)) files.push(f); });
      render();
    }
    function render() {
      list.innerHTML = '';
      go.disabled = !files.length || running;
      files.forEach((f, i) => {
        const li = PL.el('li');
        li.innerHTML = '<span class="nm"></span><span class="mt">' + PL.fmtBytes(f.size) + '</span><button title="remove" aria-label="remove">✕</button>';
        li.querySelector('.nm').textContent = f.name;
        li.querySelector('button').onclick = () => { if (!running) { files.splice(i, 1); render(); } };
        list.appendChild(li);
      });
    }
    const setBar = f => { bar.style.display = 'block'; bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; };
    const secs = s => s < 90 ? Math.round(s) + 's' : Math.round(s / 60) + ' min';

    go.onclick = async () => {
      running = true; ac = new AbortController(); go.disabled = true; stop.style.display = ''; out.innerHTML = ''; prev.style.display = 'none';
      PL.busy = () => running; PL.cleanup = () => { ac.abort(); PL.ocr.shutdown(); };
      const o = F.values(); const combine = root.querySelector('#f_combine').checked;
      const isPdf = f => /\.pdf$/i.test(f.name);
      const imgs = files.filter(f => !isPdf(f)), pdfs = files.filter(isPdf);
      const jobs = pdfs.map(f => ({ kind: 'pdf', files: [f] }));
      if (imgs.length) { if (combine) jobs.push({ kind: 'img', files: imgs }); else imgs.forEach(f => jobs.push({ kind: 'img', files: [f] })); }
      const t0 = performance.now(); let allText = '', okN = 0; const usedBase = new Set();
      try {
        for (let j = 0; j < jobs.length; j++) {
          const jb = jobs[j], label = jb.files.length > 1 ? jb.files.length + ' images' : jb.files[0].name;
          const ctx = { signal: ac.signal, progress: (fr, m) => {
            const total = jobs.length, f = (j + fr) / total, el = (performance.now() - t0) / 1000;
            setBar(f);
            log.set('Searchable — ' + label + (m ? ' · ' + m : '') + (f > 0.05 ? ' · ~' + secs(el * (1 - f) / f) + ' left' : ''));
          } };
          let r;
          if (jb.kind === 'pdf') r = await PL.ocr.fromPdf(new Uint8Array(await jb.files[0].arrayBuffer()), { ...o, wantText: true }, ctx);
          else {
            const bufs = []; for (const f of jb.files) bufs.push({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
            r = await PL.ocr.fromImages(bufs, { ...o, wantText: true }, ctx);
          }
          let base = (jb.files.length > 1 ? 'images' : jb.files[0].name.replace(/\.[^.]+$/, ''));
          if (usedBase.has(base)) { let k = 2; while (usedBase.has(base + '-' + k)) k++; base += '-' + k; }       // "scan.pdf" + "scan.png" must not collide
          usedBase.add(base);
          out.appendChild(PL.download(r.bytes, base + '-searchable.pdf'));
          if (r.text) out.appendChild(PL.download(new TextEncoder().encode(r.text), base + '.txt', 'text/plain'));
          allText += (allText ? '\n\n' : '') + (jobs.length > 1 ? '=== ' + label + ' ===\n' : '') + r.text;
          log.set(label + ': ' + r.note, 'ok'); okN++;
        }
        setBar(1);
        prev.querySelector('textarea').value = allText; prev.style.display = '';
        log.set('Done — ' + okN + ' file' + (okN > 1 ? 's' : '') + ' in ' + secs((performance.now() - t0) / 1000) + '. Open the PDF and try Ctrl/⌘+F.', 'ok');
      } catch (e) {
        log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Failed: ' + PL.friendlyError(e), 'err');
      }
      running = false; stop.style.display = 'none'; go.disabled = !files.length; PL.busy = null; PL.cleanup = null;
      PL.ocr.shutdown();
    };
    stop.onclick = () => { if (ac) ac.abort(); PL.ocr.shutdown(); log.set('Cancelling…'); };
  });
})(window.PaperLab);
