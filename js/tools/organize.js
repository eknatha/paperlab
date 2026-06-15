/* PaperLab tool: Organize (reorder / delete / duplicate / rotate per page) */
(function (PL) {
  PL.register('organize', function (root) {
    const { PDFDocument, degrees } = PL.lib();
    let file = null, order = [], rotes = {}, sel = null, srcDoc = null;
    const cache = {};
    root.appendChild(PL.dropZone(load, '.pdf', false));
    root.appendChild(PL.el('div', 'note', 'Drag thumbnails to reorder. Click a thumbnail to select, then use the buttons. Rotation applies per selected page.'));
    const thumbs = PL.el('div', 'thumbs'); root.appendChild(thumbs);
    const tools = PL.el('div', 'actions'); tools.style.display = 'none';
    const bDup = PL.el('button', 'btn ghost', 'Duplicate');
    const bDel = PL.el('button', 'btn ghost', 'Delete');
    const bRot = PL.el('button', 'btn ghost', 'Rotate 90°');
    tools.append(bDup, bDel, bRot); root.appendChild(tools);
    const actions = PL.el('div', 'actions'); const go = PL.el('button', 'btn', 'Save PDF'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);

    async function load(fs) {
      file = fs[0]; log.set('Rendering pages…');
      const buf = await PL.readArrayBuffer(file);
      srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const n = srcDoc.getPageCount();
      order = Array.from({ length: n }, (_, i) => i); rotes = {};
      const pdf = await pdfjsLib.getDocument({ data: buf.slice() }).promise;
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: .3 });
        const cv = PL.el('canvas'); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        cache[i - 1] = cv.toDataURL();
      }
      render(); tools.style.display = 'flex'; go.disabled = false; log.set('');
    }
    function render() {
      thumbs.innerHTML = '';
      order.forEach((srcIdx, pos) => {
        const th = PL.el('div', 'th' + (sel === pos ? ' sel' : ''));
        th.draggable = true;
        const rot = rotes[pos] || 0;
        th.innerHTML = `<span class="n">${pos + 1}${rot ? ' ↻' + rot : ''}</span><img style="transform:rotate(${rot}deg)" src="${cache[srcIdx]}">`;
        th.onclick = () => { sel = sel === pos ? null : pos; render(); };
        th.ondragstart = e => e.dataTransfer.setData('text', pos);
        th.ondragover = e => e.preventDefault();
        th.ondrop = e => {
          e.preventDefault(); const from = +e.dataTransfer.getData('text');
          const m = order.splice(from, 1)[0]; order.splice(pos, 0, m); sel = null; render();
        };
        thumbs.appendChild(th);
      });
    }
    bDup.onclick = () => { if (sel == null) return; order.splice(sel + 1, 0, order[sel]); render(); };
    bDel.onclick = () => { if (sel == null) return; order.splice(sel, 1); sel = null; render(); };
    bRot.onclick = () => { if (sel == null) return; rotes[sel] = ((rotes[sel] || 0) + 90) % 360; render(); };

    go.onclick = async () => {
      out.innerHTML = ''; log.set('Building…');
      try {
        const doc = await PDFDocument.create();
        const copied = await doc.copyPages(srcDoc, order);
        copied.forEach((p, pos) => {
          const r = rotes[pos] || 0;
          if (r) p.setRotation(degrees((p.getRotation().angle + r) % 360));
          doc.addPage(p);
        });
        const bytes = await doc.save();
        out.appendChild(PL.download(bytes, 'paperlab-organized.pdf'));
        log.set('Done — ' + doc.getPageCount() + ' pages.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
  });
})(window.PaperLab);
