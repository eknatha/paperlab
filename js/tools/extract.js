/* PaperLab tool: Extract text */
(function (PL) {
  PL.register('extract', function (root) {
    let file = null;
    root.appendChild(PL.dropZone(fs => { file = fs[0]; info.textContent = file.name; go.disabled = false; }, '.pdf', false));
    const info = PL.el('div', 'log'); root.appendChild(info);
    root.appendChild(PL.el('div', 'note', 'Works on text-based PDFs. Scanned/image PDFs return nothing — use OCR (coming) for those.'));
    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Extract'); go.disabled = true;
    const copy = PL.el('button', 'btn ghost', 'Copy');
    const dl = PL.el('button', 'btn ghost', 'Download .txt');
    actions.append(go, copy, dl); root.appendChild(actions);
    const log = PL.logger(root);
    const ta = PL.el('textarea', 'extract-out'); ta.placeholder = 'Extracted text appears here…'; root.appendChild(ta);
    const out = PL.el('div', 'out'); root.appendChild(out);
    go.onclick = async () => {
      log.set('Extracting…');
      try {
        const pdf = await pdfjsLib.getDocument({ data: await PL.readArrayBuffer(file) }).promise;
        let txt = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const c = await page.getTextContent();
          txt += c.items.map(it => it.str).join(' ') + '\n\n';
        }
        ta.value = txt.trim(); log.set('Done — ' + pdf.numPages + ' pages.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
    copy.onclick = () => { ta.select(); document.execCommand('copy'); log.set('Copied.', 'ok'); };
    dl.onclick = () => { out.innerHTML = ''; out.appendChild(PL.download(new Blob([ta.value], { type: 'text/plain' }), 'paperlab-text.txt', 'text/plain')); };
  });
})(window.PaperLab);
