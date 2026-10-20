/* Patram tool: Scan to PDF (camera or photos). Engine: js/scan/engine.js — everything stays on this device. */
(function (PL) {
  PL.register('scan', function (root) {
    const S = PL.scan; let pages = [], sel = -1, stream = null, running = false, ac = null, drag = -1;
    const MAX = 2600;

    const bar = PL.el('div', 'actions');
    const bCam = PL.el('button', 'btn', '📷 Open camera'); bCam.type = 'button';
    const bPick = PL.el('button', 'btn ghost', 'Take / choose photos'); bPick.type = 'button';
    const inp = PL.el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.style.display = 'none'; inp.id = 'scan_file';
    bar.append(bCam, bPick, inp); root.appendChild(bar);
    const hint = PL.el('div', 'note', 'Lay the page flat on a dark surface in good light. Patram finds the edges, straightens the page and cleans it up like a scanner. Photos never leave your device.');
    root.appendChild(hint);

    /* ── live camera ── */
    const cam = PL.el('div', 'scan-cam'); cam.style.display = 'none';
    const vid = PL.el('video'); vid.setAttribute('playsinline', ''); vid.muted = true; vid.autoplay = true; vid.style.cssText = 'width:100%;max-height:60vh;background:#000;border-radius:10px';
    const camBar = PL.el('div', 'actions');
    const bShot = PL.el('button', 'btn', 'Capture'); bShot.type = 'button';
    const bFlip = PL.el('button', 'btn ghost', 'Switch camera'); bFlip.type = 'button';
    const bClose = PL.el('button', 'btn ghost', 'Close camera'); bClose.type = 'button';
    camBar.append(bShot, bFlip, bClose); cam.append(vid, camBar); root.appendChild(cam);
    const log = PL.logger(root);
    let facing = 'environment';
    async function openCam() {
      closeCam();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { log.set('This browser cannot open the camera here (it needs HTTPS). Use “Take / choose photos” instead.', 'err'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
        vid.srcObject = stream; cam.style.display = ''; await vid.play().catch(() => {}); log.set('');
      } catch (e) {
        log.set(e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser, or use “Take / choose photos”.' : 'No camera available (' + (e && e.name || 'error') + '). Use “Take / choose photos” instead.', 'err');
      }
    }
    function closeCam() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } vid.srcObject = null; cam.style.display = 'none'; }
    bCam.onclick = openCam; bClose.onclick = closeCam;
    bFlip.onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; openCam(); };
    bShot.onclick = () => {
      if (!vid.videoWidth) { log.set('Camera is still starting…'); return; }
      addCanvas(S.fromVideo(vid, MAX), 'Camera ' + (pages.length + 1));
    };
    bPick.onclick = () => inp.click();
    inp.onchange = async () => {
      const fs = [...inp.files]; inp.value = '';
      for (const f of fs) {
        try { addCanvas(await S.fromBlob(f, MAX), f.name); } catch (e) { log.set(f.name + ': ' + PL.friendlyError(e), 'err'); }
        await PL.tick();
      }
    };
    root.addEventListener('dragover', e => e.preventDefault());
    root.addEventListener('drop', e => { e.preventDefault(); const fs = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type)); if (fs.length) { inp.files = e.dataTransfer.files; inp.onchange(); } });

    function addCanvas(cv, name) {
      const d = S.detect(cv);
      pages.push({ src: cv, quad: d.quad, found: d.found, rot: 0, filter: 'enhance', name });
      sel = pages.length - 1; render(); log.set(d.found ? 'Page edges found — drag the corners if they are off.' : 'Edges not clear — drag the four corners onto the page corners.');
    }

    /* ── editor ── */
    const ed = PL.el('div', 'scan-ed'); ed.style.display = 'none'; root.appendChild(ed);
    const stage = PL.el('div'); stage.style.cssText = 'position:relative;max-width:100%;touch-action:none;margin:10px 0';
    const cv = PL.el('canvas'); cv.style.cssText = 'width:100%;display:block;border-radius:8px;touch-action:none;cursor:crosshair'; cv.id = 'scan_cv';
    stage.appendChild(cv); ed.appendChild(stage);
    const fchips = PL.el('div', 'chips');
    S.FILTERS.forEach(([v, t]) => { const b = PL.el('button', 'chip', t); b.type = 'button'; b.dataset.v = v; b.onclick = () => { if (pages[sel]) { pages[sel].filter = v; render(); } }; fchips.appendChild(b); });
    ed.appendChild(fchips);
    const eb = PL.el('div', 'actions');
    const mkb = (t, fn, cls) => { const b = PL.el('button', 'btn ' + (cls || 'ghost'), t); b.type = 'button'; b.onclick = fn; eb.appendChild(b); return b; };
    mkb('Auto-detect', () => { const p = pages[sel]; if (!p) return; const d = S.detect(p.src); p.quad = d.quad; p.found = d.found; render(); });
    mkb('Whole photo', () => { const p = pages[sel]; if (!p) return; p.quad = S.inset(p.src, 0); render(); });
    mkb('⟲ Rotate', () => { const p = pages[sel]; if (!p) return; p.rot = (p.rot + 270) % 360; render(); });
    mkb('⟳ Rotate', () => { const p = pages[sel]; if (!p) return; p.rot = (p.rot + 90) % 360; render(); });
    ed.appendChild(eb);

    function drawEditor() {
      const p = pages[sel]; if (!p) { ed.style.display = 'none'; return; }
      ed.style.display = '';
      const k = Math.min(1, 900 / Math.max(p.src.width, p.src.height));
      cv.width = Math.round(p.src.width * k); cv.height = Math.round(p.src.height * k);
      const g = cv.getContext('2d'); g.drawImage(p.src, 0, 0, cv.width, cv.height);
      const q = p.quad.map(a => ({ x: a.x * k, y: a.y * k }));
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.rect(0, 0, cv.width, cv.height); g.moveTo(q[0].x, q[0].y); q.slice(1).forEach(a => g.lineTo(a.x, a.y)); g.closePath(); g.fill('evenodd');
      g.strokeStyle = '#14b8a6'; g.lineWidth = Math.max(2, cv.width / 300); g.beginPath(); g.moveTo(q[0].x, q[0].y); q.slice(1).forEach(a => g.lineTo(a.x, a.y)); g.closePath(); g.stroke();
      const r = Math.max(10, cv.width / 45);
      q.forEach(a => { g.fillStyle = '#14b8a6'; g.beginPath(); g.arc(a.x, a.y, r, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); });
      fchips.querySelectorAll('.chip').forEach(b => { const on = b.dataset.v === p.filter; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    }
    function pt(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; }
    cv.addEventListener('pointerdown', e => {
      const p = pages[sel]; if (!p) return; const m = pt(e), k = cv.width / p.src.width; let best = -1, bd = Math.max(28, cv.width / 14);
      p.quad.forEach((a, i) => { const d = Math.hypot(a.x * k - m.x, a.y * k - m.y); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { drag = best; cv.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    cv.addEventListener('pointermove', e => {
      if (drag < 0) return; const p = pages[sel], m = pt(e), k = cv.width / p.src.width;
      p.quad[drag] = { x: Math.max(0, Math.min(p.src.width, m.x / k)), y: Math.max(0, Math.min(p.src.height, m.y / k)) }; drawEditor();
    });
    const endDrag = () => { if (drag >= 0) { drag = -1; thumbOf(sel); renderList(); } };
    cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

    /* ── page list ── */
    const list = PL.el('div', 'thumbs'); root.appendChild(list);
    function thumbOf(i) {
      const p = pages[i]; if (!p) return;
      let c = S.warp(p.src, p.quad, 260); c = S.rotate(c, p.rot); c = S.filter(c, p.filter); p.thumb = c.toDataURL('image/jpeg', 0.7); PL.freeCanvas(c);
    }
    function renderList() {
      list.innerHTML = '';
      pages.forEach((p, i) => {
        if (!p.thumb) thumbOf(i);
        const th = PL.el('div', 'th'); th.style.outline = i === sel ? '2px solid var(--acc)' : 'none'; th.dataset.i = i;
        const im = PL.el('img'); im.src = p.thumb; im.alt = 'Page ' + (i + 1); im.style.aspectRatio = 'auto'; im.style.objectFit = 'contain'; im.style.background = '#fff';
        im.onclick = () => { sel = i; render(); };
        const n = PL.el('div', 'n', (i + 1) + ''); 
        const row = PL.el('div'); row.style.cssText = 'display:flex;gap:2px;padding:3px;justify-content:center';
        [['◀', -1], ['▶', 1], ['✕', 0]].forEach(([t, d]) => {
          const b = PL.el('button', 'chip', t); b.type = 'button'; b.style.cssText = 'padding:2px 8px;min-height:28px;font-size:12px'; b.setAttribute('aria-label', d < 0 ? 'Move earlier' : d > 0 ? 'Move later' : 'Delete page');
          b.onclick = () => {
            if (!d) { PL.freeCanvas(p.src); pages.splice(i, 1); sel = Math.min(sel, pages.length - 1); }
            else { const j = i + d; if (j < 0 || j >= pages.length) return; [pages[i], pages[j]] = [pages[j], pages[i]]; sel = j; }
            render();
          }; row.appendChild(b);
        });
        th.append(im, n, row); list.appendChild(th);
      });
      build.disabled = !pages.length || running; clear.style.display = pages.length ? '' : 'none';
      count.textContent = pages.length ? pages.length + (pages.length === 1 ? ' page' : ' pages') : '';
    }

    /* ── output ── */
    const count = PL.el('div', 'log');
    const FO = PL.buildFields([
      { id: 'size', label: 'Page size', type: 'select', value: 'a4', options: [['a4', 'A4'], ['letter', 'US Letter'], ['fit', 'Same shape as the scan']] },
      { id: 'quality', label: 'Quality', type: 'select', value: 'normal', options: [['small', 'Small file'], ['normal', 'Balanced'], ['high', 'High quality']] },
      { id: 'ocr', label: 'Make text searchable (OCR)', type: 'check', value: false }
    ]);
    root.append(count, FO.el);
    const acts = PL.el('div', 'actions');
    const build = PL.el('button', 'btn', 'Create PDF'); build.disabled = true; build.type = 'button';
    const clear = PL.el('button', 'btn ghost', 'Clear all'); clear.type = 'button'; clear.style.display = 'none';
    const stop = PL.el('button', 'btn ghost', 'Cancel'); stop.type = 'button'; stop.style.display = 'none';
    acts.append(build, clear, stop); root.appendChild(acts);
    const out = PL.el('div', 'out'); root.appendChild(out);

    function render() { drawEditor(); if (pages[sel]) thumbOf(sel); renderList(); }
    clear.onclick = () => { pages.forEach(p => PL.freeCanvas(p.src)); pages = []; sel = -1; out.innerHTML = ''; render(); log.set(''); };

    build.onclick = async () => {
      running = true; ac = new AbortController(); build.disabled = true; stop.style.display = ''; out.innerHTML = '';
      PL.busy = () => running; PL.cleanup = () => { ac.abort(); closeCam(); };
      try {
        const o = FO.values(), ctx = { signal: ac.signal, name: 'scan', progress: (f, m) => log.set('Building PDF — ' + m + '…') };
        let bytes = await S.toPdf(pages, o, ctx);
        if (o.ocr && PL.ops.searchable) {
          const r = await PL.ops.searchable.run(bytes, { lang: 'eng', eng: true, dpi: '200', skipText: false, enhance: false, wantText: false }, { signal: ac.signal, name: 'scan.pdf', progress: (f, m) => log.set('Recognising text — ' + m + '…') });
          bytes = r.bytes;
        }
        const d = new Date(), stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
        out.appendChild(PL.download(bytes, 'scan-' + stamp + '.pdf'));
        log.set('Done — ' + pages.length + (pages.length === 1 ? ' page' : ' pages') + ', ' + PL.fmtBytes(bytes.length) + '.', 'ok');
      } catch (e) { log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Failed: ' + PL.friendlyError(e), 'err'); }
      running = false; stop.style.display = 'none'; build.disabled = !pages.length; PL.busy = null; PL.cleanup = closeCam;
    };
    stop.onclick = () => { if (ac) ac.abort(); };
    PL.cleanup = closeCam;
    render();
  });
})(window.PaperLab);
