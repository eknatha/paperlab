/* PaperLab tool: Metadata view / edit / strip */
(function (PL) {
  PL.register('meta', function (root) {
    const { PDFDocument } = PL.lib();
    let file = null, doc = null;
    root.appendChild(PL.dropZone(load, '.pdf', false));
    const ctl = PL.el('div', 'ctl'); ctl.style.display = 'none';
    ctl.innerHTML = `<div class="field"><label>Title</label><input id="m_title"></div>
    <div class="field"><label>Author</label><input id="m_author"></div>
    <div class="field"><label>Subject</label><input id="m_subj"></div>
    <div class="field"><label>Keywords</label><input id="m_kw"></div>`;
    root.appendChild(ctl);
    const actions = PL.el('div', 'actions'); actions.style.display = 'none';
    const save = PL.el('button', 'btn', 'Save changes');
    const strip = PL.el('button', 'btn ghost', 'Strip all metadata');
    actions.append(save, strip); root.appendChild(actions);
    const log = PL.logger(root); const out = PL.el('div', 'out'); root.appendChild(out);

    async function load(fs) {
      file = fs[0]; doc = await PDFDocument.load(await PL.readArrayBuffer(file), { ignoreEncryption: true });
      root.querySelector('#m_title').value = doc.getTitle() || '';
      root.querySelector('#m_author').value = doc.getAuthor() || '';
      root.querySelector('#m_subj').value = doc.getSubject() || '';
      root.querySelector('#m_kw').value = doc.getKeywords() || '';
      ctl.style.display = 'flex'; actions.style.display = 'flex'; log.set('Loaded — edit fields and save.');
    }
    async function apply(stripAll) {
      out.innerHTML = '';
      try {
        if (stripAll) {
          doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
        } else {
          doc.setTitle(root.querySelector('#m_title').value);
          doc.setAuthor(root.querySelector('#m_author').value);
          doc.setSubject(root.querySelector('#m_subj').value);
          const kw = root.querySelector('#m_kw').value;
          doc.setKeywords(kw ? kw.split(',').map(s => s.trim()) : []);
        }
        const bytes = await doc.save();
        out.appendChild(PL.download(bytes, 'paperlab-metadata.pdf'));
        log.set(stripAll ? 'Metadata stripped.' : 'Metadata updated.', 'ok');
      } catch (e) { log.set('Failed: ' + e.message, 'err'); }
    }
    save.onclick = () => apply(false);
    strip.onclick = () => apply(true);
  });
})(window.PaperLab);
