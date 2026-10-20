/* Patram — shared helpers + global namespace
   Every tool file registers into PaperLab.tools[id] = builderFn(rootEl). */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  // pdf.js worker (vendored → works with no network)
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', document.baseURI).href;
  }

  // device profile — drives batch concurrency, canvas limits, ZIP part size
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && window.matchMedia && matchMedia('(pointer:coarse)').matches);
  PL.env = {
    mobile: mobile,
    cores: navigator.hardwareConcurrency || 2,
    mem: navigator.deviceMemory || (mobile ? 2 : 8),          // GB (approx, Chromium only)
    maxCanvasPx: mobile ? 8e6 : 24e6,                          // iOS Safari caps canvases near 16.7 MP
    dirPicker: typeof window.showDirectoryPicker === 'function' && !mobile
  };

  PL.tick = function () { return new Promise(r => setTimeout(r, 0)); };

  // lazy script loader (tesseract / fontkit are only fetched when needed)
  const loaded = {};
  PL.loadScript = function (src) {
    const url = new URL(src, document.baseURI).href;
    if (loaded[url]) return loaded[url];
    return (loaded[url] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url; s.onload = res; s.onerror = () => { delete loaded[url]; rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    }));
  };

  // cheap file-type sniffing on the first bytes
  PL.sniff = function (u8) {
    const head = String.fromCharCode.apply(null, u8.subarray(0, 1024));
    if (head.indexOf('%PDF-') !== -1) return 'pdf';
    if (u8[0] === 0xFF && u8[1] === 0xD8) return 'jpg';
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'png';
    if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return 'webp';
    if (u8[0] === 0x50 && u8[1] === 0x4B && (u8[2] === 3 || u8[2] === 5) ) return 'zip';          // EPUB / CBZ are ZIP containers
    return null;
  };

  PL.friendlyError = function (e) {
    const m = (e && (e.message || e.name || String(e))) || 'Unknown error';
    if (/\b(EPUB|CBZ|ZIP archive|DRM)\b/.test(m) || /^(Wrong password|Enter a password|Password is too long|The two passwords do not match|This PDF (needs a password|is already password)|Could not (unlock|protect))/.test(m)) return m;                    // e-book / comic messages are already user-facing
    if (e && e.name === 'AbortError') return 'Cancelled';
    if (e && e.name === 'PasswordException' || /encrypt|password/i.test(m)) return 'Password-protected PDF — open the Unlock tool first (you need the password)';
    if (/Failed to parse|No PDF header|Invalid PDF|InvalidPDF|bad XRef|Missing PDF|not a valid/i.test(m)) return 'Not a valid PDF (damaged or wrong file type)';
    if (/allocation|memory|out of/i.test(m)) return 'Out of memory — try fewer parallel files or a smaller file';
    return m.length > 140 ? m.slice(0, 140) + '…' : m;
  };

  PL.natCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

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
    const a = PL.el('a', null, '<span class="nm"></span><span class="dl">↓ download</span>');
    a.firstChild.textContent = name;                 // filenames come from the user — never inject as HTML
    a.href = url; a.download = name;
    return a;
  };

  /* Build a controls row from op.fields descriptors → { el, values() }.
     f.showIf = [otherId, value] / f.showNotIf = [otherId, value] toggle a field with another field's value. */
  PL.buildFields = function (fields, filter) {
    const wrap = PL.el('div', 'ctl'), get = {}, boxes = {}, inputs = {};
    fields.forEach(f => {
      if (filter && !filter(f)) return;
      const box = PL.el('div', 'field' + (f.type === 'check' ? ' check' : ''));
      const lab = PL.el('label'); lab.textContent = f.label; lab.htmlFor = 'f_' + f.id;
      let inp;
      if (f.type === 'select') {
        inp = PL.el('select');
        f.options.forEach(o => { const op = PL.el('option'); op.value = o[0]; op.textContent = o[1]; inp.appendChild(op); });
        inp.value = f.value; get[f.id] = () => inp.value;
      } else if (f.type === 'check') {
        inp = PL.el('input'); inp.type = 'checkbox'; inp.checked = !!f.value; get[f.id] = () => inp.checked;
      } else {
        inp = PL.el('input'); inp.type = f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'; inp.value = f.value;
        if (f.type === 'password') { inp.autocomplete = 'new-password'; inp.spellcheck = false; inp.setAttribute('autocapitalize', 'off'); }
        if (f.type === 'number') inp.inputMode = 'decimal';
        if (f.min != null) inp.min = f.min; get[f.id] = () => inp.value;
      }
      inp.id = 'f_' + f.id;
      if (f.type === 'check') box.append(inp, lab); else box.append(lab, inp);
      wrap.appendChild(box); boxes[f.id] = { box, f }; inputs[f.id] = inp;
    });
    const sync = () => Object.keys(boxes).forEach(id => {
      const f = boxes[id].f; let show = true;
      if (f.showIf && inputs[f.showIf[0]]) show = get[f.showIf[0]]() === f.showIf[1];
      if (f.showNotIf && inputs[f.showNotIf[0]]) show = get[f.showNotIf[0]]() !== f.showNotIf[1];
      boxes[id].box.style.display = show ? '' : 'none';
    });
    Object.keys(inputs).forEach(id => inputs[id].addEventListener('change', sync));
    sync();
    return { el: wrap, inputs, sync, values: () => { const o = {}; Object.keys(get).forEach(k => o[k] = get[k]()); return o; } };
  };

  /* tools set PL.busy = () => bool and PL.cleanup = fn while a job is running; app.js honours them on close */
  PL.busy = null; PL.cleanup = null;

  // register helper used by each tool file
  PL.register = function (id, builderFn) { PL.tools[id] = builderFn; };
})(window.PaperLab);
