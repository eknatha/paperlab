/* PaperLab — shared helpers + global namespace
   Every tool file registers into PaperLab.tools[id] = builderFn(rootEl). */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  // pdf.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // pdf-lib shortcuts (resolved lazily so load order doesn't matter)
  PL.lib = function () { return window.PDFLib; };

  PL.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  PL.fmtBytes = function (b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  };

  PL.readArrayBuffer = async function (file) {
    return new Uint8Array(await file.arrayBuffer());
  };

  PL.dropZone = function (onFiles, accept, multi) {
    const d = PL.el('div', 'drop',
      'Drop file' + (multi ? 's' : '') + ' here or <b>browse</b><div class="hint">processed locally · nothing uploaded</div>');
    const inp = PL.el('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = !!multi; inp.style.display = 'none';
    d.appendChild(inp);
    d.onclick = () => inp.click();
    inp.onchange = () => { if (inp.files.length) onFiles([...inp.files]); };
    d.ondragover = e => { e.preventDefault(); d.classList.add('drag'); };
    d.ondragleave = () => d.classList.remove('drag');
    d.ondrop = e => {
      e.preventDefault(); d.classList.remove('drag');
      if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
    };
    return d;
  };

  PL.logger = function (parent) {
    const l = PL.el('div', 'log');
    parent.appendChild(l);
    return { set: (m, cls) => { l.innerHTML = cls ? `<span class="${cls}">${m}</span>` : m; } };
  };

  PL.download = function (bytes, name, type) {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: type || 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = PL.el('a', null, `<span>${name}</span><span class="dl">↓ download</span>`);
    a.href = url; a.download = name;
    return a;
  };

  // register helper used by each tool file
  PL.register = function (id, builderFn) { PL.tools[id] = builderFn; };
})(window.PaperLab);
