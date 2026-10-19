/* PaperLab tool: Watermark */
(function (PL) {
  PL.register('watermark', function (root) {
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
        const r = await PL.ops.watermark.run(await PL.readArrayBuffer(file), {
          txt: root.querySelector('#txt').value, op: root.querySelector('#op').value,
          ly: root.querySelector('#ly').value, sz: root.querySelector('#sz').value, lenient: true
        });
        out.appendChild(PL.download(r.bytes, 'paperlab-watermarked.pdf'));
        log.set('Done.', 'ok');
      } catch (e) { log.set('Failed: ' + PL.friendlyError(e), 'err'); }
    };
  });
})(window.PaperLab);
