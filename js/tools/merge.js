/* PaperLab tool: Merge */
(function (PL) {
  PL.register('merge', function (root) {
    const { PDFDocument } = PL.lib();
    let files = [];
    const list = PL.el('ul', 'files');
    root.appendChild(PL.dropZone(add, '.pdf', true));
    root.appendChild(list);
    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Merge PDFs'); go.disabled = true;
    actions.appendChild(go); root.appendChild(actions);
    const log = PL.logger(root);
    const out = PL.el('div', 'out'); root.appendChild(out);

    function add(fs) { files = files.concat(fs.filter(f => f.name.toLowerCase().endsWith('.pdf'))); render(); }
    function render() {
      list.innerHTML = ''; go.disabled = files.length < 2;
      files.forEach((f, i) => {
        const li = PL.el('li'); li.draggable = true;
        li.innerHTML = `<span class="grab">⠿</span><span class="nm">${f.name}</span><span class="mt">${PL.fmtBytes(f.size)}</span><button title="remove">✕</button>`;
        li.querySelector('button').onclick = () => { files.splice(i, 1); render(); };
        li.ondragstart = e => { li.classList.add('dragging'); e.dataTransfer.setData('text', i); };
        li.ondragend = () => li.classList.remove('dragging');
        li.ondragover = e => e.preventDefault();
        li.ondrop = e => { e.preventDefault(); const from = +e.dataTransfer.getData('text'); const m = files.splice(from, 1)[0]; files.splice(i, 0, m); render(); };
        list.appendChild(li);
      });
    }
    go.onclick = async () => {
      go.disabled = true; out.innerHTML = ''; log.set('Merging ' + files.length + ' files…');
      try {
        const merged = await PDFDocument.create();
        for (const f of files) {
          const src = await PDFDocument.load(await PL.readArrayBuffer(f), { ignoreEncryption: true });
          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        }
        const bytes = await merged.save();
        out.appendChild(PL.download(bytes, 'paperlab-merged.pdf'));
        log.set('Done — ' + merged.getPageCount() + ' pages.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
      go.disabled = false;
    };
  });
})(window.PaperLab);
