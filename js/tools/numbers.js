/* PaperLab tool: Page numbers / Bates */
(function (PL) {
  PL.register('numbers', function (root) {
    const { PDFDocument, rgb, StandardFonts } = PL.lib();
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
        const doc = await PDFDocument.load(await PL.readArrayBuffer(file), { ignoreEncryption: true });
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const fmt = root.querySelector('#fmt').value, pos = root.querySelector('#pos').value;
        const start = +root.querySelector('#start').value || 1, pre = root.querySelector('#pre').value;
        const pages = doc.getPages(), N = pages.length;
        pages.forEach((p, i) => {
          const num = start + i; let label;
          if (fmt === 'np') label = 'Page ' + num;
          else if (fmt === 'not') label = num + ' / ' + (start + N - 1);
          else label = '' + num;
          if (pre) label = pre + label;
          const { width: w } = p.getSize(); const sz = 10; const tw = font.widthOfTextAtSize(label, sz);
          let x; if (pos === 'bc') x = (w - tw) / 2; else if (pos === 'br') x = w - tw - 36; else x = 36;
          p.drawText(label, { x, y: 24, size: sz, font, color: rgb(.3, .3, .3) });
        });
        const bytes = await doc.save();
        out.appendChild(PL.download(bytes, 'paperlab-numbered.pdf'));
        log.set('Done — ' + N + ' pages.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
  });
})(window.PaperLab);
