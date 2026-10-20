/* Patram — Compare PDFs: text + pixel diff algorithms (no DOM except canvas helpers).
   Text   : words are extracted with pdf.js, then diffed with Myers' O(ND) algorithm (shared prefix/suffix trimmed first).
   Pixels : shift-tolerant luminance diff — a pixel only counts as changed when nothing similar exists within 1 px in the
            other page, so anti-aliasing / sub-pixel shifts never light up. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const X = PL.cmp = PL.cmp || {};

  /* ───────── text extraction ───────── */
  /* → { pages:[{tokens:[...]}], tokens:[...], page:Uint32Array (page index per token), chars } */
  X.extractText = async function (pdf, onProgress, signal) {
    const tokens = [], pageOf = [], pages = [];
    let chars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      if (signal && signal.aborted) { const e = new Error('Cancelled'); e.name = 'AbortError'; throw e; }
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let buf = '', prev = null;
      for (const it of tc.items) {
        if (!it.str) { if (it.hasEOL) buf += ' '; continue; }
        if (prev) {
          const h = Math.max(prev.height || 0, it.height || 0) || 10;
          const sameLine = Math.abs(it.transform[5] - prev.transform[5]) < h * 0.5;
          if (!sameLine) buf += ' ';
          else if (it.transform[4] - (prev.transform[4] + prev.width) > h * 0.15) buf += ' ';
        }
        buf += it.str; prev = it;
        if (it.hasEOL) { buf += ' '; prev = null; }
      }
      page.cleanup();
      const toks = buf.normalize('NFC').match(/\S+/g) || [];
      pages.push({ tokens: toks });
      chars += buf.length;
      for (const t of toks) { tokens.push(t); pageOf.push(p - 1); }
      if (onProgress) onProgress(p / pdf.numPages);
      if (p % 8 === 0) await PL.tick();
    }
    return { pages, tokens, page: Uint32Array.from(pageOf), chars };
  };

  /* ───────── Myers diff ───────── */
  /* a, b: Int32Array of token ids. Returns { delA:Uint8Array, insB:Uint8Array, exact:boolean }.
     delA[i]=1 → a[i] has no counterpart; insB[j]=1 → b[j] is new. */
  X.myers = function (a, b, maxD) {
    maxD = maxD || 2500;
    const n0 = a.length, m0 = b.length;
    const delA = new Uint8Array(n0), insB = new Uint8Array(m0);
    let pre = 0;
    while (pre < n0 && pre < m0 && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < n0 - pre && suf < m0 - pre && a[n0 - 1 - suf] === b[m0 - 1 - suf]) suf++;
    const n = n0 - pre - suf, m = m0 - pre - suf;
    if (n === 0 || m === 0) {                                        // pure insertion / deletion / identical
      for (let i = 0; i < n; i++) delA[pre + i] = 1;
      for (let j = 0; j < m; j++) insB[pre + j] = 1;
      return { delA, insB, exact: true };
    }
    const A = a.subarray(pre, pre + n), B = b.subarray(pre, pre + m);
    const max = Math.min(n + m, maxD), off = max + 2;
    const v = new Int32Array(2 * max + 5);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2));                  // state before round d, indexed by k + d + 1
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && A[x] === B[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) { found = d; break; }
      }
    }
    if (found < 0) return { delA, insB, exact: false };               // too different → caller falls back
    let x = n, y = m;
    delA.fill(1, pre, pre + n); insB.fill(1, pre, pre + m);           // start "all unmatched", clear what matches
    for (let d = found; d > 0; d--) {
      const t = trace[d], k = x - y;
      const goDown = (k === -d || (k !== d && t[k - 1 + d + 1] < t[k + 1 + d + 1]));
      const pk = goDown ? k + 1 : k - 1;
      const px = t[pk + d + 1], py = px - pk;
      while (x > px && y > py) { x--; y--; delA[pre + x] = 0; insB[pre + y] = 0; }   // diagonal = match
      x = px; y = py;
    }
    while (x > 0 && y > 0) { x--; y--; delA[pre + x] = 0; insB[pre + y] = 0; }       // the d = 0 diagonal
    return { delA, insB, exact: true };
  };

  /* Whole-document word diff. Positional per-page fallback if the documents are too different for Myers. */
  X.diffText = function (ta, tb, opts) {
    opts = opts || {};
    const norm = opts.ignoreCase ? s => s.toLowerCase() : s => s;
    const ids = new Map();
    const idOf = s => { s = norm(s); let i = ids.get(s); if (i === undefined) { i = ids.size; ids.set(s, i); } return i; };
    const a = Int32Array.from(ta.tokens, idOf), b = Int32Array.from(tb.tokens, idOf);
    let r = X.myers(a, b, opts.maxD);
    let approx = false;
    if (!r.exact) {                                                   // positional fallback
      approx = true;
      const delA = new Uint8Array(a.length), insB = new Uint8Array(b.length);
      const np = Math.max(ta.pages.length, tb.pages.length);
      let ao = 0, bo = 0;
      for (let p = 0; p < np; p++) {
        const na = ta.pages[p] ? ta.pages[p].tokens.length : 0, nb = tb.pages[p] ? tb.pages[p].tokens.length : 0;
        const q = X.myers(a.subarray(ao, ao + na), b.subarray(bo, bo + nb), 1500);
        if (q.exact) { delA.set(q.delA, ao); insB.set(q.insB, bo); }
        else { delA.fill(1, ao, ao + na); insB.fill(1, bo, bo + nb); }
        ao += na; bo += nb;
      }
      r = { delA, insB };
    }
    const hunks = X.hunks(r.delA, r.insB);
    return { delA: r.delA, insB: r.insB, hunks, approx, removed: r.delA.reduce((s, x) => s + x, 0), added: r.insB.reduce((s, x) => s + x, 0) };
  };

  /* consecutive unmatched runs → [{as,ae,bs,be}] (half-open token ranges in A and B) */
  X.hunks = function (delA, insB) {
    const hunks = [], n = delA.length, m = insB.length;
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && !delA[i] && j < m && !insB[j]) { i++; j++; continue; }
      const as = i, bs = j;
      while (i < n && delA[i]) i++;
      while (j < m && insB[j]) j++;
      if (i === as && j === bs) { i++; j++; continue; }               // safety: never loop forever
      const last = hunks[hunks.length - 1];
      if (last && as - last.ae <= 2) { last.ae = i; last.be = j; }     // fuse changes split by ≤2 unchanged words ("the") → readable hunks
      else hunks.push({ as, ae: i, bs, be: j });
    }
    return hunks;
  };

  /* ───────── pixel diff ───────── */
  function luma(d, n) {
    const g = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000 | 0;
    return g;
  }
  function minmax3(g, w, h) {           // separable 3×3 min & max
    const n = w * h, mn = new Uint8Array(n), mx = new Uint8Array(n), tn = new Uint8Array(n), tx = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let lo = g[i], hi = g[i];
      if (x > 0) { const v = g[i - 1]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (x < w - 1) { const v = g[i + 1]; if (v < lo) lo = v; if (v > hi) hi = v; }
      tn[i] = lo; tx[i] = hi;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let lo = tn[i], hi = tx[i];
      if (y > 0) { const k = i - w; if (tn[k] < lo) lo = tn[k]; if (tx[k] > hi) hi = tx[k]; }
      if (y < h - 1) { const k = i + w; if (tn[k] < lo) lo = tn[k]; if (tx[k] > hi) hi = tx[k]; }
      mn[i] = lo; mx[i] = hi;
    }
    return { mn, mx };
  }

  /* Draw both sources top-left onto equal-size white canvases. src: canvas | null (blank). */
  function normalise(ca, cb) {
    const w = Math.max(ca ? ca.width : 1, cb ? cb.width : 1), h = Math.max(ca ? ca.height : 1, cb ? cb.height : 1);
    const mk = c => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      if (c) g.drawImage(c, 0, 0);
      return { cv, g };
    };
    return { w, h, A: mk(ca), B: mk(cb) };
  }

  /* → { canvas (diff render), changed, aOnly, bOnly, pct, sizeDiffers }.  opts.render=false → stats only. */
  X.pixelDiff = function (ca, cb, opts) {
    opts = opts || {};
    const tol = opts.tol == null ? 24 : opts.tol;
    const N = normalise(ca, cb), w = N.w, h = N.h, n = w * h;
    const da = N.A.g.getImageData(0, 0, w, h).data, db = N.B.g.getImageData(0, 0, w, h).data;
    const ga = luma(da, n), gb = luma(db, n);
    const A = minmax3(ga, w, h), B = minmax3(gb, w, h);
    let aOnly = 0, bOnly = 0;
    const flag = new Uint8Array(n);                                    // 1 = only in A, 2 = only in B
    for (let i = 0; i < n; i++) {
      if (ga[i] < B.mn[i] - tol) { flag[i] = 1; aOnly++; }
      else if (gb[i] < A.mn[i] - tol) { flag[i] = 2; bOnly++; }
    }
    const res = { changed: aOnly + bOnly, aOnly, bOnly, pct: (aOnly + bOnly) / n * 100, w, h,
                  sizeDiffers: !!(ca && cb && (ca.width !== cb.width || ca.height !== cb.height)) };
    if (opts.render === false) return res;
    /* render: faded page, red = only in A, blue = only in B, soft yellow halo on changed regions */
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const g = out.getContext('2d'), img = g.createImageData(w, h), o = img.data;
    const CELL = 14, cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL), hot = new Uint8Array(cw * ch);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (flag[i]) hot[((y / CELL) | 0) * cw + ((x / CELL) | 0)] = 1;
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      const j = i * 4; let r, gg, bb;
      if (flag[i] === 1) { r = 220; gg = 38; bb = 38; }
      else if (flag[i] === 2) { r = 29; gg = 78; bb = 216; }
      else {
        const base = 255 - (255 - Math.min(ga[i], gb[i])) * 0.4;       // unchanged content, faded
        r = gg = bb = base;
        if (hot[((y / CELL) | 0) * cw + ((x / CELL) | 0)]) { r = Math.min(255, base + 6); gg = Math.min(255, base + 4); bb = base - 70 < 0 ? 0 : base - 70 + 20; }
      }
      o[j] = r; o[j + 1] = gg; o[j + 2] = bb; o[j + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    res.canvas = out; res.A = N.A.cv; res.B = N.B.cv;
    return res;
  };
})(window.PaperLab);
