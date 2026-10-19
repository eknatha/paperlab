/* PaperLab tool: E-books & comics — EPUB ⇄ PDF and CBZ ⇄ PDF.  Engine: js/books/engine.js (shared with Mass Batch). */
(function (PL) {
  PL.register('books', function (root) {
    const DIRS = [
      ['epub2pdf', 'EPUB → PDF', '.epub,application/epub+zip', 'epub'],
      ['cbz2pdf', 'CBZ → PDF', '.cbz,.zip,application/zip,application/vnd.comicbook+zip', 'cbz'],
      ['pdf2epub', 'PDF → EPUB', '.pdf,application/pdf', 'pdf'],
      ['pdf2cbz', 'PDF → CBZ', '.pdf,application/pdf', 'pdf']
    ];
    const OUTMIME = { pdf: 'application/pdf', epub: 'application/epub+zip', cbz: 'application/vnd.comicbook+zip' };
    let dir = 'epub2pdf', files = [], running = false, ac = null, F = null;

    const lab = PL.el('div', 'chips-label', 'Convert'); root.appendChild(lab);
    const chips = PL.el('div', 'chips'); chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'Conversion');
    DIRS.forEach(([id, t]) => {
      const b = PL.el('button', 'chip', t); b.type = 'button'; b.dataset.v = id; b.setAttribute('role', 'radio'); b.onclick = () => setDir(id); chips.appendChild(b);
    });
    root.appendChild(chips);

    const dzHost = PL.el('div'); root.appendChild(dzHost);
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

    const NOTES = {
      epub2pdf: 'Typesets the book into a PDF with selectable text, headings, lists, images and bookmarks. Latin text and the major Indian scripts are supported; right-to-left languages (Urdu, Arabic) are not laid out correctly yet. <b>DRM-protected books are refused</b> — PaperLab never removes DRM. Convert only books you own or are licensed to use.',
      cbz2pdf: 'Packs the pages of a comic archive (CBZ, or any ZIP of images) into a PDF in natural page order. JPEGs are embedded untouched, so there is no quality loss. CBR (RAR) archives are not supported.',
      pdf2epub: 'Reflowable mode re-flows the text so it reads well on a phone; page-image mode keeps the exact look. PDFs without a text layer automatically use page images (run <b>Searchable</b> first if you want reflowable text).',
      pdf2cbz: 'Renders each page as an image and zips them in order, with a ComicInfo.xml, for comic readers.'
    };
    function setDir(id) {
      dir = id; files = []; renderList(); out.innerHTML = ''; log.set(''); bar.style.display = 'none';
      chips.querySelectorAll('.chip').forEach(b => { const on = b.dataset.v === id; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      const d = DIRS.find(x => x[0] === id);
      dzHost.innerHTML = ''; dzHost.appendChild(PL.dropZone(fs => { files = files.concat(fs).slice(0, 50); renderList(); }, d[2], true));
      F = PL.buildFields(PL.ops[id].fields); optHost.innerHTML = ''; optHost.appendChild(F.el);
      note.innerHTML = NOTES[id];
      go.textContent = 'Convert';
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
      const op = PL.ops[dir], o = F.values(), used = new Set(); let okN = 0;
      const t0 = performance.now();
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]; PL.abortIf({ signal: ac.signal });
          log.set('Converting ' + (i + 1) + '/' + files.length + ' — ' + f.name + '…');
          try {
            const buf = new Uint8Array(await PL.readArrayBuffer(f));
            const r = await op.run(buf, o, { signal: ac.signal, name: f.name, progress: (fr, m) => { setBar((i + fr) / files.length); log.set('Converting ' + (i + 1) + '/' + files.length + ' — ' + m + '…'); } });
            let stem = f.name.replace(/\.[^.]*$/, ''), nm = stem + '.' + (r.ext || op.ext), k = 2;
            while (used.has(nm)) nm = stem + '-' + (k++) + '.' + (r.ext || op.ext);
            used.add(nm); okN++;
            const a = PL.download(r.bytes, nm, OUTMIME[r.ext || op.ext]);
            if (r.note) a.title = r.note;
            out.appendChild(a);
            if (r.note) { const n = PL.el('div', 'log'); n.textContent = nm + ' — ' + r.note; out.appendChild(n); }
          } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            const n = PL.el('div', 'log err'); n.textContent = f.name + ' — ' + PL.friendlyError(e); out.appendChild(n);
          }
        }
        setBar(1);
        log.set((okN === files.length ? 'Done' : 'Finished with errors') + ' — ' + okN + ' of ' + files.length + ' converted in ' + Math.round((performance.now() - t0) / 1000) + ' s.', okN === files.length ? 'ok' : 'err');
      } catch (e) { log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Failed: ' + PL.friendlyError(e), 'err'); }
      running = false; stop.style.display = 'none'; go.disabled = !files.length; PL.busy = null; PL.cleanup = null;
    };
    stop.onclick = () => { if (ac) ac.abort(); log.set('Cancelling…'); };
    setDir('epub2pdf');
  });
})(window.PaperLab);
