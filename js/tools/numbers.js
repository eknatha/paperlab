/* Patram tool: Page numbers / Bates */
(function (PL) {
  PL.register('numbers', function (root) {
    let file = null;
    root.appendChild(PL.dropZone(fs => { file = fs[0]; info.textContent = file.name; go.disabled = false; }, '.pdf', false));
    const info = PL.el('div', 'log'); root.appendChild(info);
    const ctl = PL.el('div', 'ctl');
    ctl.innerHTML = `<div class="field"><label>Format</label><select id="fmt"><option value="n">1, 2, 3…</option><option value="np">Page 1</option><option value="not">1 / N</option></select></div>
    <div class="field"><label>Position</label><select id="pos"><option value="bc">Bottom center</option><option value="br">Bottom right</option><option value="bl">Bottom left</option></select></div>
    <div class="field"><label>Start at</label><input id="start" type="number" value="1" min="1" style="min-width:80px"></div>
    <div class="field"><label>Prefix (Bates)</label><input id="pre" placeholder="optional"></div>`;
    root.appendChild(ctl);
    const actions = PL.el('div', 'actions'); const go = PL.el('button', 'btn', 'Add numbers'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);
    go.onclick = async () => {
      out.innerHTML = ''; log.set('Numbering…');
      try {
        const r = await PL.ops.numbers.run(await PL.readArrayBuffer(file), {
          fmt: root.querySelector('#fmt').value, pos: root.querySelector('#pos').value,
          start: root.querySelector('#start').value, pre: root.querySelector('#pre').value, lenient: true
        });
        out.appendChild(PL.download(r.bytes, 'patram-numbered.pdf'));
        log.set('Done — ' + r.note + '.', 'ok');
      } catch (e) { log.set('Failed: ' + PL.friendlyError(e), 'err'); }
    };
  });
})(window.PaperLab);
