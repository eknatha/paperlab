/* PaperLab — hero demo: live before/after on a mock PDF page.
   Left = raw document, right = "processed" (watermark + page number stamped).
   Drawn procedurally on canvas — same before/after concept as ImageLab. */
(function (PL) {
  const cv = document.getElementById('demoCv');
  const frame = document.getElementById('frame');
  const handle = document.getElementById('demoHandle');
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.onclick = () => {
    const t = document.getElementById('primary');
    (t || document.getElementById('grid')).scrollIntoView({ behavior: 'smooth' });
  };
  if (!cv) return;

  const ctx = cv.getContext('2d');
  const W = cv.width = 760, H = cv.height = 486;
  let split = 0.5;

  // pre-render the two layers once
  const raw = document.createElement('canvas'); raw.width = W; raw.height = H;
  const done = document.createElement('canvas'); done.width = W; done.height = H;

  function drawPage(c, processed) {
    const g = c.getContext('2d');
    // backdrop
    g.fillStyle = '#0f141b'; g.fillRect(0, 0, W, H);
    // page
    const pad = 70, pw = W - pad * 2, ph = H - 50;
    const px = pad, py = 24;
    g.fillStyle = '#f4f6fb';
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
    g.fillRect(px, py, pw, ph);
    g.shadowColor = 'transparent';
    // header bar
    g.fillStyle = processed ? '#14b8a6' : '#c2c9d6';
    g.fillRect(px, py, pw, 8);
    // title line
    g.fillStyle = '#2a2f3a';
    g.fillRect(px + 34, py + 40, pw * 0.5, 16);
    // text lines
    g.fillStyle = '#c2c9d6';
    let ly = py + 78;
    for (let i = 0; i < 11; i++) {
      const lw = (i % 3 === 2) ? pw * 0.45 : pw * 0.78;
      g.fillRect(px + 34, ly, lw - 34, 7);
      ly += 20;
    }
    // a little block / figure
    g.fillStyle = processed ? 'rgba(20,184,166,.18)' : '#e6e9f0';
    g.fillRect(px + 34, ly + 8, pw - 68, 70);

    if (processed) {
      // diagonal watermark
      g.save();
      g.translate(px + pw / 2, py + ph / 2);
      g.rotate(-Math.PI / 7);
      g.font = '700 46px ui-monospace, monospace';
      g.fillStyle = 'rgba(20,184,166,.22)';
      g.textAlign = 'center';
      g.fillText('PAPERLAB', 0, 0);
      g.restore();
      // page number
      g.fillStyle = '#14b8a6';
      g.font = '600 13px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText('— 1 —', px + pw / 2, py + ph - 14);
    }
  }
  drawPage(raw, false);
  drawPage(done, true);

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(raw, 0, 0);
    const sx = Math.round(W * split);
    ctx.drawImage(done, sx, 0, W - sx, H, sx, 0, W - sx, H);
  }
  function setSplit(clientX) {
    const r = frame.getBoundingClientRect();
    split = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    handle.style.left = (split * 100) + '%';
    render();
  }
  render();
  let drag = false;
  handle.addEventListener('mousedown', () => drag = true);
  window.addEventListener('mouseup', () => drag = false);
  window.addEventListener('mousemove', e => { if (drag) setSplit(e.clientX); });
  frame.addEventListener('click', e => { if (e.target !== handle && !handle.contains(e.target)) setSplit(e.clientX); });
  handle.addEventListener('touchmove', e => { setSplit(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
})(window.PaperLab);
