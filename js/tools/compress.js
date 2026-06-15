/* PaperLab tool: Compress (rasterize → JPEG → rebuild) */
(function (PL) {
  PL.register('compress', function (root) {
    const { PDFDocument } = PL.lib();
    let file = null;
    root.appendChild(PL.dropZone(fs => { file = fs[0]; info.textContent = file.name + ' · ' + PL.fmtBytes(file.size); go.disabled = false; }, '.pdf', false));
    const info = PL.el('div', 'log'); root.appendChild(info);
    const ctl = PL.el('div', 'ctl');
    ctl.innerHTML = `<div class="field"><label>Strength</label><select id="q"><option value="0.6">Balanced</option><option value="0.4">Smaller</option><option value="0.8">Light</option></select></div>
    <div class="field"><label>Resolution</label><select id="dpi"><option value="1.3">Standard</option><option value="1">Low</option><option value="1.8">High</option></select></div>`;
    root.appendChild(ctl);
    root.appendChild(PL.el('div', 'note', 'Compression rasterizes each page to a JPEG and rebuilds the PDF — text becomes non-selectable. Best for image-heavy or scanned PDFs. Deep stream optimization needs the qpdf.wasm module (coming).'));
    const actions = PL.el('div', 'actions'); const go = PL.el('button', 'btn', 'Compress'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);
    go.onclick = async () => {
      out.innerHTML = ''; log.set('Compressing…');
      try {
        const buf = await PL.readArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const q = +root.querySelector('#q').value, dpi = +root.querySelector('#dpi').value;
        const doc = await PDFDocument.create();
        for (let i = 1; i <= pdf.numPages; i++) {
          log.set('Page ' + i + '/' + pdf.numPages + '…');
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: dpi });
          const cv = PL.el('canvas'); cv.width = vp.width; cv.height = vp.height;
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
          const img = await doc.embedJpg(await PL.readArrayBuffer(blob));
          const p = doc.addPage([img.width, img.height]);
          p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        }
        const bytes = await doc.save();
        const saved = file.size - bytes.length;
        out.appendChild(PL.download(bytes, 'paperlab-compressed.pdf'));
        log.set(`Done — ${PL.fmtBytes(bytes.length)} (${saved > 0 ? '−' + PL.fmtBytes(saved) : 'no reduction'}).`, saved > 0 ? 'ok' : 'err');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
  });
})(window.PaperLab);
