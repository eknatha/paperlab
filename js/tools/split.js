/* PaperLab tool: Split */
(function (PL) {
  PL.register('split', function (root) {
    const { PDFDocument } = PL.lib();
    let file = null, total = 0;
    root.appendChild(PL.dropZone(async fs => {
      file = fs[0];
      const doc = await PDFDocument.load(await PL.readArrayBuffer(file), { ignoreEncryption: true });
      total = doc.getPageCount();
      info.textContent = file.name + ' · ' + total + ' pages'; go.disabled = false;
    }, '.pdf', false));
    const info = PL.el('div', 'log'); root.appendChild(info);
    const ctl = PL.el('div', 'ctl');
    ctl.innerHTML = `<div class="field"><label>Page ranges</label><input id="ranges" placeholder="e.g. 1-3, 5, 8-10"></div>`;
    root.appendChild(ctl);
    root.appendChild(PL.el('div', 'note', 'Each comma-separated range becomes its own PDF. Leave blank to split every page into a single file.'));
    const actions = PL.el('div', 'actions'); const go = PL.el('button', 'btn', 'Split'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);

    function parseRanges(str, max) {
      if (!str.trim()) return [];
      const out = [];
      str.split(',').forEach(part => {
        part = part.trim(); if (!part) return;
        const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) { let a = +m[1] - 1, b = +m[2] - 1; a = Math.max(0, a); b = Math.min(max - 1, b); if (a <= b) out.push([a, b]); }
        else { const p = +part - 1; if (p >= 0 && p < max) out.push([p, p]); }
      });
      return out;
    }
    go.onclick = async () => {
      out.innerHTML = ''; log.set('Splitting…');
      try {
        const src = await PDFDocument.load(await PL.readArrayBuffer(file), { ignoreEncryption: true });
        let ranges = parseRanges(root.querySelector('#ranges').value, total);
        if (!ranges.length) ranges = Array.from({ length: total }, (_, i) => [i, i]);
        let n = 0;
        for (const [a, b] of ranges) {
          const doc = await PDFDocument.create();
          const idx = []; for (let i = a; i <= b; i++) idx.push(i);
          const pages = await doc.copyPages(src, idx); pages.forEach(p => doc.addPage(p));
          const bytes = await doc.save();
          out.appendChild(PL.download(bytes, `paperlab-pages-${a + 1}${b > a ? '-' + (b + 1) : ''}.pdf`)); n++;
        }
        log.set('Done — ' + n + ' file' + (n > 1 ? 's' : '') + ' ready.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
  });
})(window.PaperLab);
