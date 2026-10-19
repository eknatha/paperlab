/* PaperLab tool: Rotate (all pages) */
(function (PL) {
  PL.register('rotate', function (root) {
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
        const r = await PL.ops.rotate.run(await PL.readArrayBuffer(file), { deg: root.querySelector('#deg').value, lenient: true });
        out.appendChild(PL.download(r.bytes, 'paperlab-rotated.pdf'));
        log.set('Done.', 'ok');
      } catch (e) { log.set('Failed: ' + PL.friendlyError(e), 'err'); }
    };
  });
})(window.PaperLab);
