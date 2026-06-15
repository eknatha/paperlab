/* PaperLab tool: PDF → Images */
(function (PL) {
  PL.register('pdf2img', function (root) {
    let file = null;
    root.appendChild(PL.dropZone(fs => { file = fs[0]; info.textContent = file.name; go.disabled = false; }, '.pdf', false));
    const info = PL.el('div', 'log'); root.appendChild(info);
    const ctl = PL.el('div', 'ctl');
    ctl.innerHTML = `<div class="field"><label>Format</label><select id="fmt"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></div>
    <div class="field"><label>Quality (scale)</label><select id="scale"><option value="1.5">Standard</option><option value="2.5">High</option><option value="1">Small</option></select></div>`;
    root.appendChild(ctl);
    const actions = PL.el('div', 'actions'); const go = PL.el('button', 'btn', 'Export images'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);
    go.onclick = async () => {
      out.innerHTML = ''; log.set('Rendering…');
      try {
        const buf = await PL.readArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const fmt = root.querySelector('#fmt').value, scale = +root.querySelector('#scale').value;
        const ext = fmt === 'image/png' ? 'png' : 'jpg';
        for (let i = 1; i <= pdf.numPages; i++) {
          log.set('Rendering page ' + i + '/' + pdf.numPages + '…');
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale });
          const cv = PL.el('canvas'); cv.width = vp.width; cv.height = vp.height;
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          const blob = await new Promise(r => cv.toBlob(r, fmt, .92));
          out.appendChild(PL.download(blob, `paperlab-page-${i}.${ext}`, fmt));
        }
        log.set('Done — ' + pdf.numPages + ' image' + (pdf.numPages > 1 ? 's' : '') + '.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
  });
})(window.PaperLab);
