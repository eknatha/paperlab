/* Patram — camera / photo document scanner engine (all on <canvas>, nothing leaves the device).
   detect(): finds the paper in a photo · warp(): perspective-corrects it · filter(): scan-style clean-up · toPdf(): pages → PDF. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const S = PL.scan = {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

  /* ── load an image file / blob into a canvas no larger than maxSide (EXIF orientation honoured by the browser) ── */
  S.fromBlob = async function (blob, maxSide) {
    let bmp = null;
    try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('This file is not a readable image')); }; im.src = u; });
    }
    const w = bmp.width, h = bmp.height, k = Math.min(1, maxSide / Math.max(w, h));
    const c = mk(w * k, h * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  };
  S.fromVideo = function (video, maxSide) {
    const w = video.videoWidth, h = video.videoHeight, k = Math.min(1, maxSide / Math.max(w, h));
    const c = mk(w * k, h * k); c.getContext('2d').drawImage(video, 0, 0, c.width, c.height); return c;
  };

  /* ── find the document: brightness segmentation (Otsu) → biggest blob → its four extreme corners ── */
  S.detect = function (cv) {
    const sc = 320 / Math.max(cv.width, cv.height), w = Math.max(8, Math.round(cv.width * sc)), h = Math.max(8, Math.round(cv.height * sc));
    const t = mk(w, h), g = t.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
    // 3×3 box blur
    const bl = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += gray[yy * w + xx]; n++; } } bl[y * w + x] = s / n; }
    // Otsu
    const hist = new Array(256).fill(0); bl.forEach(v => hist[v]++);
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sB = 0, best = 0, thr = 128; const tot = w * h;
    for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = i; } }
    const quadOf = (paperBright) => {
      const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = (bl[i] > thr) === paperBright ? 1 : 0;
      // biggest connected component (4-neighbour flood fill)
      const lab = new Int32Array(w * h); let bestN = 0, bestL = 0, L = 0; const stack = [];
      for (let i = 0; i < w * h; i++) {
        if (!mask[i] || lab[i]) continue; L++; let n = 0; stack.push(i); lab[i] = L;
        while (stack.length) { const p = stack.pop(); n++; const x = p % w, y = (p / w) | 0; if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = L; stack.push(p - 1); } if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = L; stack.push(p + 1); } if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = L; stack.push(p - w); } if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = L; stack.push(p + w); } }
        if (n > bestN) { bestN = n; bestL = L; }
      }
      if (bestN < 0.12 * w * h) return null;
      let tl = null, tr = null, br = null, bl2 = null, a = 1e9, b = -1e9, c = -1e9, e = 1e9;
      for (let i = 0; i < w * h; i++) if (lab[i] === bestL) { const x = i % w, y = (i / w) | 0, s = x + y, df = x - y; if (s < a) { a = s; tl = { x, y }; } if (s > b) { b = s; br = { x, y }; } if (df > c) { c = df; tr = { x, y }; } if (df < e) { e = df; bl2 = { x, y }; } }
      const area = Math.abs((tl.x * tr.y - tr.x * tl.y) + (tr.x * br.y - br.x * tr.y) + (br.x * bl2.y - bl2.x * br.y) + (bl2.x * tl.y - tl.x * bl2.y)) / 2;
      return { q: [tl, tr, br, bl2], frac: area / (w * h), fill: bestN / Math.max(1, area) };
    };
    // paper is normally the brighter region; if the border is mostly bright the paper must be the darker one
    let bb = 0, bn = 0; for (let x = 0; x < w; x++) { bb += bl[x] > thr; bb += bl[(h - 1) * w + x] > thr; bn += 2; } for (let y = 0; y < h; y++) { bb += bl[y * w] > thr; bb += bl[y * w + w - 1] > thr; bn += 2; }
    const first = bb / bn < 0.5;
    let r = quadOf(first);
    if (!r || r.frac < 0.2 || r.fill < 0.55) { const r2 = quadOf(!first); if (r2 && (!r || r2.fill > r.fill)) r = r2; }
    if (!r || r.frac < 0.2 || r.frac > 0.985 || r.fill < 0.55) return { quad: S.inset(cv, 0.04), found: false };
    const inv = 1 / sc;
    return { quad: r.q.map(p => ({ x: clamp(p.x * inv, 0, cv.width), y: clamp(p.y * inv, 0, cv.height) })), found: true };
  };
  S.inset = (cv, f) => [{ x: cv.width * f, y: cv.height * f }, { x: cv.width * (1 - f), y: cv.height * f }, { x: cv.width * (1 - f), y: cv.height * (1 - f) }, { x: cv.width * f, y: cv.height * (1 - f) }];

  /* ── perspective correction: bilinear sampling through the unit-square → quad homography ── */
  S.warp = function (src, quad, maxSide) {
    const [A, B, C, D] = quad;                                         // TL TR BR BL
    let w = Math.max(dist(A, B), dist(D, C)), h = Math.max(dist(A, D), dist(B, C));
    const k = Math.min(1, maxSide / Math.max(w, h)); w = Math.max(8, Math.round(w * k)); h = Math.max(8, Math.round(h * k));
    const out = mk(w, h), og = out.getContext('2d');
    const isRect = Math.abs(A.x - D.x) < 1.5 && Math.abs(B.x - C.x) < 1.5 && Math.abs(A.y - B.y) < 1.5 && Math.abs(D.y - C.y) < 1.5;
    if (isRect) { og.drawImage(src, A.x, A.y, B.x - A.x, D.y - A.y, 0, 0, w, h); return out; }
    // homography from unit square (0,0)(1,0)(1,1)(0,1) to the quad
    const dx1 = B.x - C.x, dx2 = D.x - C.x, dx3 = A.x - B.x + C.x - D.x, dy1 = B.y - C.y, dy2 = D.y - C.y, dy3 = A.y - B.y + C.y - D.y;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    const gg = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
    const a = B.x - A.x + gg * B.x, b = D.x - A.x + hh * D.x, c = A.x, d = B.y - A.y + gg * B.y, e = D.y - A.y + hh * D.y, f = A.y;
    const sg = src.getContext('2d', { willReadFrequently: true }), sw = src.width, sh = src.height, sd = sg.getImageData(0, 0, sw, sh).data;
    const od = og.createImageData(w, h), o = od.data;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, z = gg * u + hh * v + 1, sx = (a * u + b * v + c) / z - 0.5, sy = (d * u + e * v + f) / z - 0.5;
        const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, i = (y * w + x) * 4;
        const xa = clamp(x0, 0, sw - 1), xb = clamp(x0 + 1, 0, sw - 1), ya = clamp(y0, 0, sh - 1), yb = clamp(y0 + 1, 0, sh - 1);
        const p00 = (ya * sw + xa) * 4, p10 = (ya * sw + xb) * 4, p01 = (yb * sw + xa) * 4, p11 = (yb * sw + xb) * 4;
        for (let ch = 0; ch < 3; ch++) o[i + ch] = (sd[p00 + ch] * (1 - fx) + sd[p10 + ch] * fx) * (1 - fy) + (sd[p01 + ch] * (1 - fx) + sd[p11 + ch] * fx) * fy;
        o[i + 3] = 255;
      }
    }
    og.putImageData(od, 0, 0); return out;
  };

  S.rotate = function (cv, deg) {
    deg = ((deg % 360) + 360) % 360; if (!deg) return cv;
    const sw = deg === 90 || deg === 270, out = mk(sw ? cv.height : cv.width, sw ? cv.width : cv.height), g = out.getContext('2d');
    g.translate(out.width / 2, out.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(cv, -cv.width / 2, -cv.height / 2); return out;
  };

  /* ── filters ── */
  S.FILTERS = [['color', 'Original'], ['enhance', 'Enhanced'], ['gray', 'Grayscale'], ['bw', 'Black & white']];
  S.filter = function (cv, mode) {
    if (mode === 'color') return cv;
    const w = cv.width, h = cv.height, out = mk(w, h), g = out.getContext('2d', { willReadFrequently: true });
    g.drawImage(cv, 0, 0);
    const id = g.getImageData(0, 0, w, h), d = id.data;
    // background (paper + lighting) estimated on a small, blurred copy, then divided out → even white paper, dark ink
    const sw = Math.max(4, Math.round(w / 12)), sh = Math.max(4, Math.round(h / 12)), sm = mk(sw, sh), sg = sm.getContext('2d', { willReadFrequently: true });
    sg.drawImage(cv, 0, 0, sw, sh);
    const sd = sg.getImageData(0, 0, sw, sh).data, lum = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) lum[i] = sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114;
    // local maximum then blur ≈ paper brightness even where text is dense
    const R = 3, mx = new Float32Array(sw * sh), bg = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let m = 0; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < sw && yy < sh) m = Math.max(m, lum[yy * sw + xx]); } mx[y * sw + x] = m; }
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let s = 0, n = 0; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < sw && yy < sh) { s += mx[yy * sw + xx]; n++; } } bg[y * sw + x] = Math.max(60, s / n); }
    for (let y = 0; y < h; y++) {
      const fy = clamp(y / h * sh - 0.5, 0, sh - 1), y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = clamp(x / w * sw - 0.5, 0, sw - 1), x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
        const b = (bg[y0 * sw + x0] * (1 - tx) + bg[y0 * sw + x1] * tx) * (1 - ty) + (bg[y1 * sw + x0] * (1 - tx) + bg[y1 * sw + x1] * tx) * ty;
        const i = (y * w + x) * 4, k = 255 / b;
        if (mode === 'enhance') {
          for (let c = 0; c < 3; c++) { const v = d[i + c] * k; d[i + c] = clamp((v - 40) * (255 / (235 - 40)), 0, 255); }
        } else {
          const gv = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * k;
          const v = mode === 'bw' ? (gv < 190 ? 0 : 255) : clamp((gv - 40) * (255 / (235 - 40)), 0, 255);
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
    }
    g.putImageData(id, 0, 0); return out;
  };

  /* ── pages → PDF ── */
  const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
  S.toPdf = async function (pages, o, ctx) {
    o = o || {}; ctx = ctx || {};
    const { PDFDocument } = PL.lib(), doc = await PDFDocument.create();
    const q = o.quality === 'high' ? 0.92 : o.quality === 'small' ? 0.6 : 0.8;
    const maxSide = o.quality === 'high' ? 3000 : o.quality === 'small' ? 1500 : 2200;
    for (let i = 0; i < pages.length; i++) {
      PL.abortIf(ctx); (ctx.progress || (() => {}))(i / pages.length, 'page ' + (i + 1) + '/' + pages.length);
      let c = S.warp(pages[i].src, pages[i].quad, maxSide);
      c = S.rotate(c, pages[i].rot || 0); c = S.filter(c, pages[i].filter || 'enhance');
      const blob = await PL.canvasToBlob(c, 'image/jpeg', q), img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      let pw, ph; const sz = SIZES[o.size];
      if (sz) { const land = c.width > c.height; pw = land ? sz[1] : sz[0]; ph = land ? sz[0] : sz[1]; } else { pw = c.width * 0.75; ph = c.height * 0.75; }
      const page = doc.addPage([pw, ph]), s = Math.min(pw / c.width, ph / c.height), w = c.width * s, h = c.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      PL.freeCanvas(c);
      if (i % 3 === 2) await PL.tick();
    }
    doc.setCreator('Patram'); doc.setProducer('Patram');
    return await doc.save();
  };
})(window.PaperLab);
