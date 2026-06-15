/* PaperLab tool: Rotate (all pages) */
(function (PL) {
  PL.register('rotate', function (root) {
    const { PDFDocument, degrees } = PL.lib();
    let file = null;
    root.appendChild(PL.dropZone(fs => { file = fs[0]; info.textContent = file.name; go.disabled = false; }, '.pdf', false));
    const info = PL.el('div', 'log'); root.appendChild(info);
    const ctl = PL.el('div', 'ctl');
    ctl.innerHTML = `<div class="field"><label>Rotate by</label><select id="deg"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° (90° CCW)</option></select></div>`;
    root.appendChild(ctl);
    const actions = PL.el('div', 'actions'); const go = PL.el('button', 'btn', 'Rotate all'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);
    go.onclick = async () => {
      out.innerHTML = ''; log.set('Rotating…');
      try {
        const doc = await PDFDocument.load(await PL.readArrayBuffer(file), { ignoreEncryption: true });
        const d = +root.querySelector('#deg').value;
        doc.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + d) % 360)));
        const bytes = await doc.save();
        out.appendChild(PL.download(bytes, 'paperlab-rotated.pdf'));
        log.set('Done.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
  });
})(window.PaperLab);
