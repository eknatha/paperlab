/* PaperLab tool: Watermark */
(function (PL) {
  PL.register('watermark', function (root) {
    const { PDFDocument, degrees, rgb, StandardFonts } = PL.lib();
    let file = null;
    root.appendChild(PL.dropZone(fs => { file = fs[0]; info.textContent = file.name; go.disabled = false; }, '.pdf', false));
    const info = PL.el('div', 'log'); root.appendChild(info);
    const ctl = PL.el('div', 'ctl');
    ctl.innerHTML = `<div class="field"><label>Text</label><input id="txt" value="CONFIDENTIAL"></div>
    <div class="field"><label>Opacity</label><select id="op"><option value="0.15">Subtle</option><option value="0.3">Medium</option><option value="0.5">Strong</option></select></div>
    <div class="field"><label>Layout</label><select id="ly"><option value="diag">Diagonal</option><option value="tile">Tiled</option></select></div>
    <div class="field"><label>Size</label><select id="sz"><option value="48">Medium</option><option value="72">Large</option><option value="32">Small</option></select></div>`;
    root.appendChild(ctl);
    const actions = PL.el('div', 'actions'); const go = PL.el('button', 'btn', 'Apply watermark'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);
    go.onclick = async () => {
      out.innerHTML = ''; log.set('Stamping…');
      try {
        const doc = await PDFDocument.load(await PL.readArrayBuffer(file), { ignoreEncryption: true });
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        const txt = root.querySelector('#txt').value || 'WATERMARK';
        const op = +root.querySelector('#op').value, sz = +root.querySelector('#sz').value, ly = root.querySelector('#ly').value;
        doc.getPages().forEach(p => {
          const { width: w, height: h } = p.getSize();
          const opts = { size: sz, font, color: rgb(.5, .5, .5), opacity: op };
          if (ly === 'diag') {
            p.drawText(txt, { ...opts, x: w * 0.12, y: h * 0.45, rotate: degrees(35) });
          } else {
            const tw = font.widthOfTextAtSize(txt, sz) + 40, th = sz + 50;
            for (let y = 20; y < h; y += th) for (let x = -20; x < w; x += tw) p.drawText(txt, { ...opts, x, y, rotate: degrees(20) });
          }
        });
        const bytes = await doc.save();
        out.appendChild(PL.download(bytes, 'paperlab-watermarked.pdf'));
        log.set('Done.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
  });
})(window.PaperLab);
