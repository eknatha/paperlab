/* PaperLab tool: PDF → Word / Excel / PowerPoint.  Engine: js/convert/*.js (shared with Mass Batch). */
(function (PL) {
  PL.register('office', function (root) {
    const DIRS = [['pdf2docx', 'Word (.docx)'], ['pdf2xlsx', 'Excel (.xlsx)'], ['pdf2pptx', 'PowerPoint (.pptx)']];
    const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    const NOTES = {
      pdf2docx: 'Rebuilds paragraphs, headings, bullet lists, tables and pictures in reading order, including multi-column pages. Best on PDFs that came from Word, Google Docs or a web page. Scanned PDFs need the OCR option. Complex layouts, text boxes and vector drawings will need touching up.',
      pdf2xlsx: 'Finds tables by looking at how text lines up in columns and puts each one on its own sheet, with numbers as real numbers (so formulas work). Bordered tables, merged cells and multi-line cells may need tidying. Bank statements and invoices usually convert well.',
      pdf2pptx: '<b>Editable</b> gives you text boxes, tables and pictures placed where they were, with the page’s graphics and colours kept as a background picture. <b>Exact look</b> puts each page on a slide as an image (not editable).'
    };
    let dir = 'pdf2docx', files = [], running = false, ac = null, F = null;

    root.appendChild(PL.el('div', 'chips-label', 'Convert PDF to'));
    const chips = PL.el('div', 'chips'); chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'Output format');
    DIRS.forEach(([id, t]) => { const b = PL.el('button', 'chip', t); b.type = 'button'; b.dataset.v = id; b.setAttribute('role', 'radio'); b.onclick = () => setDir(id); chips.appendChild(b); });
    root.appendChild(chips);

    root.appendChild(PL.dropZone(fs => { files = files.concat(fs).slice(0, 50); renderList(); }, '.pdf,application/pdf', true));
    const list = PL.el('ul', 'files'); root.appendChild(list);
    const optHost = PL.el('div'); root.appendChild(optHost);
    const note = PL.el('div', 'note'); root.appendChild(note);

    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Convert'); go.disabled = true;
    const stop = PL.el('button', 'btn ghost', 'Cancel'); stop.style.display = 'none';
    actions.append(go, stop); root.appendChild(actions);
    const bar = PL.el('div', 'bar'); bar.innerHTML = '<i></i>'; bar.style.display = 'none'; root.appendChild(bar);
    const log = PL.logger(root);
    const out = PL.el('div', 'out'); root.appendChild(out);
    const setBar = f => { bar.style.display = 'block'; bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; };

    function setDir(id) {
      dir = id; out.innerHTML = ''; log.set(''); bar.style.display = 'none';
      chips.querySelectorAll('.chip').forEach(b => { const on = b.dataset.v === id; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      F = PL.buildFields(PL.ops[id].fields); optHost.innerHTML = ''; optHost.appendChild(F.el);
      F.inputs.mode && F.inputs.mode.addEventListener('change', F.sync);
      note.innerHTML = NOTES[id] + ' Many files? Use <b>Mass Batch → Office</b>.';
    }
    function renderList() {
      list.innerHTML = ''; go.disabled = !files.length || running;
      files.forEach((f, i) => {
        const li = PL.el('li'); li.innerHTML = '<span class="nm"></span><span class="mt"></span><button aria-label="Remove">✕</button>';
        li.querySelector('.nm').textContent = f.name; li.querySelector('.mt').textContent = PL.fmtBytes(f.size);
        li.querySelector('button').onclick = () => { if (running) return; files.splice(i, 1); renderList(); };
        list.appendChild(li);
      });
    }

    go.onclick = async () => {
      running = true; ac = new AbortController(); go.disabled = true; stop.style.display = ''; out.innerHTML = '';
      PL.busy = () => running; PL.cleanup = () => ac.abort();
      const op = PL.ops[dir], o = F.values(), used = new Set(); let okN = 0; const t0 = performance.now();
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]; PL.abortIf({ signal: ac.signal });
          log.set('Converting ' + (i + 1) + '/' + files.length + ' — ' + f.name + '…');
          try {
            const buf = new Uint8Array(await PL.readArrayBuffer(f));
            const r = await op.run(buf, o, { signal: ac.signal, name: f.name, progress: (fr, m) => { setBar((i + fr) / files.length); log.set('Converting ' + (i + 1) + '/' + files.length + ' — ' + m + '…'); } });
            const stem = f.name.replace(/\.[^.]*$/, ''); let nm = stem + '.' + r.ext, k = 2;
            while (used.has(nm)) nm = stem + '-' + (k++) + '.' + r.ext;
            used.add(nm); okN++;
            out.appendChild(PL.download(r.bytes, nm, MIME[r.ext]));
            const n = PL.el('div', 'log'); n.textContent = nm + ' — ' + r.note; out.appendChild(n);
            ((r.report && r.report.warnings) || []).forEach(w => { const e = PL.el('div', 'log err'); e.textContent = '⚠ ' + w; out.appendChild(e); });
          } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            const n = PL.el('div', 'log err'); n.textContent = f.name + ' — ' + PL.friendlyError(e); out.appendChild(n);
          }
        }
        setBar(1);
        log.set((okN === files.length ? 'Done' : 'Finished with errors') + ' — ' + okN + ' of ' + files.length + ' converted in ' + Math.round((performance.now() - t0) / 1000) + ' s. Check the result before relying on it.', okN === files.length ? 'ok' : 'err');
      } catch (e) { log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Failed: ' + PL.friendlyError(e), 'err'); }
      running = false; stop.style.display = 'none'; go.disabled = !files.length; PL.busy = null; PL.cleanup = null;
    };
    stop.onclick = () => { if (ac) ac.abort(); log.set('Cancelling…'); };
    setDir('pdf2docx');
  });
})(window.PaperLab);
