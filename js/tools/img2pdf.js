/* PaperLab tool: Images → PDF */
(function (PL) {
  PL.register('img2pdf', function (root) {
    const { PDFDocument } = PL.lib();
    let imgs = [];
    const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
    const list = PL.el('ul', 'files');
    root.appendChild(PL.dropZone(add, 'image/jpeg,image/png,image/webp', true));
    root.appendChild(list);
    const ctl = PL.el('div', 'ctl');
    ctl.innerHTML = `<div class="field"><label>Page size</label><select id="size"><option value="fit">Fit to image</option><option value="a4">A4</option><option value="letter">Letter</option></select></div>
    <div class="field"><label>Orientation</label><select id="orient"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></div>`;
    root.appendChild(ctl);
    const actions = PL.el('div', 'actions'); const go = PL.el('button', 'btn', 'Build PDF'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);

    function add(fs) { imgs = imgs.concat(fs.filter(f => /image\/(jpeg|png|webp)/.test(f.type))); render(); }
    function render() {
      list.innerHTML = ''; go.disabled = !imgs.length;
      imgs.forEach((f, i) => {
        const li = PL.el('li');
        li.innerHTML = `<span class="grab">⠿</span><span class="nm">${f.name}</span><span class="mt">${PL.fmtBytes(f.size)}</span><button>✕</button>`;
        li.querySelector('button').onclick = () => { imgs.splice(i, 1); render(); };
        list.appendChild(li);
      });
    }
    function webpToPng(file) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => { const c = PL.el('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); c.toBlob(async b => res(await PL.readArrayBuffer(b)), 'image/png'); };
        img.onerror = rej; img.src = URL.createObjectURL(file);
      });
    }
    go.onclick = async () => {
      out.innerHTML = ''; log.set('Building…');
      try {
        const doc = await PDFDocument.create();
        const mode = root.querySelector('#size').value, orient = root.querySelector('#orient').value;
        for (const f of imgs) {
          const bytes = await PL.readArrayBuffer(f);
          let img;
          if (f.type === 'image/png') img = await doc.embedPng(bytes);
          else if (f.type === 'image/jpeg') img = await doc.embedJpg(bytes);
          else img = await doc.embedPng(await webpToPng(f));
          let pw, ph;
          if (mode === 'fit') { pw = img.width; ph = img.height; }
          else { [pw, ph] = SIZES[mode]; if (orient === 'landscape')[pw, ph] = [ph, pw]; }
          const page = doc.addPage([pw, ph]);
          const scale = Math.min(pw / img.width, ph / img.height, 1);
          const w = mode === 'fit' ? pw : img.width * scale, h = mode === 'fit' ? ph : img.height * scale;
          page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
        const bytes = await doc.save();
        out.appendChild(PL.download(bytes, 'paperlab-images.pdf'));
        log.set('Done — ' + imgs.length + ' page' + (imgs.length > 1 ? 's' : '') + '.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    };
  });
})(window.PaperLab);
