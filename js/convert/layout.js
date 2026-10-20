/* PaperLab — PDF layout analysis for the Word / Excel / PowerPoint converters.
   pdf.js text + image positions  →  a page model made of paragraphs, tables and pictures in reading order.
   Everything is heuristic: columns are found with an XY-cut, tables from aligned cells, headings from font size.
   It is a "best effort" conversion — complex layouts, vector drawings and unusual fonts can still need touching up. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const C = PL.convert = PL.convert || {};
  const med = a => { if (!a.length) return 10; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const clean = s => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\u2028\u2029]/g, '');

  /* ───────── 1. raw page → lines of segments ───────── */
  async function rawPage(pdf, no, opt) {
    const page = await pdf.getPage(no), vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    const tc = await page.getTextContent();
    let ops = null;
    try { ops = await page.getOperatorList(); } catch (e) { ops = null; }     // also makes pdf.js load the fonts
    const fontInfo = {};
    const finfo = name => {
      if (fontInfo[name]) return fontInfo[name];
      let f = null; try { f = page.commonObjs.has(name) ? page.commonObjs.get(name) : null; } catch (e) { f = null; }
      const nm = String((f && f.name) || (tc.styles[name] && tc.styles[name].fontFamily) || '');
      const fi = {
        bold: !!(f && (f.bold || f.black)) || /bold|black|heavy|semibold|demi/i.test(nm),
        italic: !!(f && f.italic) || /italic|oblique/i.test(nm),
        mono: !!(f && f.isMonospace) || /mono|courier|consol|typewriter/i.test(nm),
        serif: !!(f && f.isSerifFont) || (/times|serif|georgia|garamond|minion|palatino|book|cambria|roman/i.test(nm) && !/sans/i.test(nm))
      };
      return (fontInfo[name] = fi);
    };
    const items = [];
    const T = window.pdfjsLib.Util;
    for (const it of tc.items) {
      if (!it.str || !it.str.trim().length) continue;                       // pdf.js emits blank filler items with huge widths
      const m = T.transform(vp.transform, it.transform);
      const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 10;
      const w = Math.abs(it.width) * 1;
      const vertical = Math.abs(m[1]) > Math.abs(m[0]) * 0.7;
      const fi = finfo(it.fontName);
      items.push({ str: clean(it.str), x: m[4], y: m[5], size: Math.max(2, size), w: w || it.str.length * size * 0.5, vertical, bold: fi.bold, italic: fi.italic, mono: fi.mono, serif: fi.serif });
    }
    // pictures: walk the operator list keeping the transformation matrix
    const images = [];
    if (ops && window.pdfjsLib.OPS) {
      const OPS = window.pdfjsLib.OPS, stack = []; let ctm = [1, 0, 0, 1, 0, 0];
      const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], a = ops.argsArray[i];
        if (fn === OPS.save) stack.push(ctm.slice());
        else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
        else if (fn === OPS.transform) ctm = mul(a, ctm);
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
          const m = mul(ctm, vp.transform);
          const xs = [m[4], m[4] + m[0], m[4] + m[2], m[4] + m[0] + m[2]], ys = [m[5], m[5] + m[1], m[5] + m[3], m[5] + m[1] + m[3]];
          const x0 = Math.max(0, Math.min.apply(null, xs)), x1 = Math.min(W, Math.max.apply(null, xs)), t = Math.max(0, Math.min.apply(null, ys)), b = Math.min(H, Math.max.apply(null, ys));
          if (x1 - x0 >= 20 && b - t >= 20) images.push({ x0, x1, top: t, bottom: b });
        }
      }
    }
    return { page, W, H, items, images };
  }

  function buildLines(items) {
    items = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      let L = null;
      for (let k = lines.length - 1; k >= 0 && k >= lines.length - 5; k--) {
        const c = lines[k];
        if (!it.vertical && !c.vertical && Math.abs(it.y - c.y) <= Math.max(1.5, 0.42 * Math.min(it.size, c.items[0].size))) { L = c; break; }
      }
      if (!L) { L = { y: it.y, items: [], vertical: it.vertical }; lines.push(L); }
      L.items.push(it); L.y = (L.y * (L.items.length - 1) + it.y) / L.items.length;
    }
    lines.forEach(L => {
      L.items.sort((a, b) => a.x - b.x);
      // word gaps of one justified line are all about equal; real column gaps stand out from them
      const gaps = []; for (let q = 1; q < L.items.length; q++) gaps.push(L.items[q].x - (L.items[q - 1].x + L.items[q - 1].w));
      const gm = gaps.length >= 4 ? med(gaps) : null;
      const split = (factor, floor) => {
        const segs = []; let cur = null;
        for (const it of L.items) {
          const style = (r) => r.b === it.bold && r.i === it.italic && r.m === it.mono && r.c === it.color && Math.abs(r.sz - it.size) < 0.6;
          const fresh = () => { cur = { x0: it.x, x1: it.x + it.w, runs: [], size: it.size, ys: 0, n: 0 }; segs.push(cur); };
          if (!cur) fresh();
          else {
            const gap = it.x - cur.x1;
            if (gap > Math.max(factor * Math.min(it.size, cur.size), floor) && (gm == null || gm >= 2.2 * it.size || gap > 1.3 * gm + 2)) fresh();
            else {
              const last = cur.runs[cur.runs.length - 1];
              if (gap > 0.12 * it.size && last && !/\s$/.test(last.t) && !/^\s/.test(it.str)) last.t += ' ';
              cur.x1 = Math.max(cur.x1, it.x + it.w);
            }
          }
          cur.ys += it.y; cur.n++;
          const last = cur.runs[cur.runs.length - 1];
          if (last && style(last)) last.t += it.str;
          else cur.runs.push({ t: it.str, b: it.bold, i: it.italic, m: it.mono, sz: it.size, s: it.serif, c: it.color });
        }
        segs.forEach(s => {
          s.text = s.runs.map(r => r.t).join(''); s.chars = s.text.replace(/\s/g, '').length; s.y = s.ys / Math.max(1, s.n);
          const by = {}; let bv = 0; s.runs.forEach(r => { const k = Math.round(r.sz * 2) / 2; by[k] = (by[k] || 0) + r.t.length; }); Object.keys(by).forEach(k => { if (by[k] > bv) { bv = by[k]; s.size = +k; } });
        });
        return segs.filter(s => s.chars > 0);
      };
      L.cells = split(0.8, 4);            // fine split: candidate table cells
      const segs = split(1.5, 7);         // coarse split: text blocks / columns
      L.segs = segs;
      let best = 0, tot = 0; const bySize = {};
      L.segs.forEach(s => s.runs.forEach(r => { const k = Math.round(r.sz * 2) / 2; bySize[k] = (bySize[k] || 0) + r.t.length; tot += r.t.length; }));
      Object.keys(bySize).forEach(k => { if (bySize[k] > best) { best = bySize[k]; L.size = +k; } });
      L.size = L.size || 10; L.chars = tot;
      L.top = L.y - L.size * 0.85; L.bottom = L.y + L.size * 0.25;
      L.x0 = L.segs.length ? L.segs[0].x0 : 0; L.x1 = L.segs.length ? L.segs[L.segs.length - 1].x1 : 0;
    });
    return lines.filter(L => L.segs.length).sort((a, b) => a.y - b.y);
  }

  C._buildLines = buildLines;
  /* ───────── 2. tables: runs of lines whose cells line up in columns ───────── */
  const numLike = s => /^[\s$€£¥₹(+-]*\d[\d,.\s]*[%)]?\s*$/.test(s);
  function findTables(lines, W) {
    const tables = [], used = new Set(); let i = 0;
    while (i < lines.length) {
      if (lines[i].cells.length < 2) { i++; continue; }
      let j = i;
      while (j + 1 < lines.length) {
        const n = lines[j + 1], p = lines[j];
        const gapOk = n.top - p.bottom < 1.6 * p.size;
        if (n.cells.length >= 2 && gapOk) { j++; continue; }
        // a one-cell row (e.g. "Total") is allowed if the table carries on right after it
        if (n.cells.length === 1 && gapOk && j + 2 < lines.length && lines[j + 2].cells.length >= 2 && lines[j + 2].top - n.bottom < 1.6 * n.size) { j += 2; continue; }
        break;
      }
      const rows = lines.slice(i, j + 1);
      const multi = rows.filter(r => r.cells.length >= 2);
      if (multi.length >= 3) {
        // column gutters = gaps in the union of all cells' x-intervals
        const iv = [];
        rows.forEach(r => r.cells.forEach(s => iv.push([s.x0, s.x1])));
        iv.sort((a, b) => a[0] - b[0]);
        const cols = []; let cur = null;
        const msize = med(rows.map(r => r.size));
        iv.forEach(v => { if (!cur || v[0] - cur[1] > Math.max(0.6 * msize, 4)) { cur = [v[0], v[1]]; cols.push(cur); } else cur[1] = Math.max(cur[1], v[1]); });
        const segs = [].concat.apply([], rows.map(r => r.cells));
        const avg = med(segs.map(s => s.chars));                          // median cell length: prose columns are ~40 characters, table cells are short
        const numFrac = segs.filter(s => numLike(s.text)).length / segs.length;
        const wide = segs.filter(s => s.x1 - s.x0 > 0.45 * W).length / segs.length;
        if (cols.length >= 2 && cols.length <= 24 && wide < 0.25 && (avg < 27 || numFrac >= 0.3)) {
          const edges = cols.map(c => [c[0], c[1]]);
          const colOf = s => { const c = (s.x0 + s.x1) / 2; let k = edges.findIndex(e => c >= e[0] - 1 && c <= e[1] + 1); if (k < 0) { k = 0; let d = 1e9; edges.forEach((e, q) => { const dd = Math.abs((e[0] + e[1]) / 2 - c); if (dd < d) { d = dd; k = q; } }); } return k; };
          const grid = rows.map(r => { const cells = edges.map(() => []); r.cells.forEach(s => cells[colOf(s)].push(s)); return cells.map(a => ({ text: a.map(s => s.text.trim()).join(' ').trim(), runs: a.length ? a[0].runs : [], bold: a.length && a[0].runs.length && a[0].runs.every(x => x.b) })); });
          const keep = edges.map((e, ci) => grid.some(r => r[ci].text));          // drop columns that are empty in every row
          if (keep.some(k => !k) && keep.filter(Boolean).length >= 2) { grid.forEach((r, ri) => { grid[ri] = r.filter((c, ci) => keep[ci]); }); for (let q = edges.length - 1; q >= 0; q--) if (!keep[q]) edges.splice(q, 1); }
          tables.push({ kind: 'table', rows: grid, edges, x0: Math.min.apply(null, rows.map(r => r.x0)), x1: Math.max.apply(null, rows.map(r => r.x1)), top: rows[0].top, bottom: rows[rows.length - 1].bottom, size: msize, lines: rows });
          rows.forEach(r => used.add(r));
        }
      }
      i = j + 1;
    }
    return { tables, rest: lines.filter(l => !used.has(l)) };
  }

  /* ───────── 3. reading order: recursive XY-cut over text segments, tables and pictures ───────── */
  function xyCut(atoms, msize, depth) {
    if (atoms.length <= 1 || depth > 14) return [atoms];
    const hGap = Math.max(0.3 * msize, 2.5), vGap = Math.max(1.5 * msize, 12);
    const byTop = atoms.slice().sort((a, b) => a.top - b.top || a.x0 - b.x0);
    // vertical cut first: a gutter that runs the full height of this region separates columns
    const byX = atoms.slice().sort((a, b) => a.x0 - b.x0);
    let maxR = byX[0].x1, cut = -1;
    for (let i = 1; i < byX.length; i++) {
      if (byX[i].x0 - maxR > vGap) { cut = i; break; }
      maxR = Math.max(maxR, byX[i].x1);
    }
    if (cut > 0) {
      const L = xyCut(byX.slice(0, cut), msize, depth + 1), R = xyCut(byX.slice(cut), msize, depth + 1);
      if (R.length) R[0].colBreak = true;
      return L.concat(R);
    }
    // then a horizontal cut at the widest blank band (so a footer or title is split off before anything else)
    let maxB = byTop[0].bottom, best = hGap; cut = -1;
    for (let i = 1; i < byTop.length; i++) {
      if (byTop[i].top - maxB > best) { best = byTop[i].top - maxB; cut = i; }
      maxB = Math.max(maxB, byTop[i].bottom);
    }
    if (cut > 0) return xyCut(byTop.slice(0, cut), msize, depth + 1).concat(xyCut(byTop.slice(cut), msize, depth + 1));
    return [byTop];
  }
  // groups need a marker for "a column break happened before me" — carried on the first atom
  function flagGroups(groups) { return groups.map(g => { g.hard = !!g.colBreak; return g; }); }

  /* ───────── 4. paragraphs, headings, lists ───────── */
  const BULLET = /^\s*([•●▪■◦▫·‣⁃*]|[-–—](?=\s)|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[ivxIVX]{1,5}[.)])\s+\S/;
  function mergeRuns(a, b, join) {
    const out = a.map(r => Object.assign({}, r));
    if (join && out.length) out[out.length - 1].t += join;
    b.forEach(r => { const l = out[out.length - 1]; if (l && l.b === r.b && l.i === r.i && l.m === r.m && l.c === r.c && Math.abs(l.sz - r.sz) < 0.6) l.t += r.t; else out.push(Object.assign({}, r)); });
    return out;
  }
  function lineOf(group, ids) {                                  // atoms of one original line → one line object
    const a = group.slice().sort((p, q) => p.x0 - q.x0);
    let runs = a[0].runs, text = a[0].text;
    for (let k = 1; k < a.length; k++) { runs = mergeRuns(runs, a[k].runs, '\t'); text += '\t' + a[k].text; }
    return { x0: a[0].x0, x1: a[a.length - 1].x1, top: Math.min.apply(null, a.map(x => x.top)), bottom: Math.max.apply(null, a.map(x => x.bottom)), size: a[0].size, runs, text, hard: false };
  }
  function paragraphs(lines, bodySize, pageW) {
    const paras = []; let cur = null, blockR = 0;
    lines.forEach((ln, idx) => { blockR = Math.max(blockR, ln.x1); });
    const endsSentence = t => /[.!?:;)"”’]\s*$/.test(t);
    for (const ln of lines) {
      const bullet = BULLET.test(ln.text) && ln.text.length > 2;
      let join = false;
      if (cur && !ln.hard && !bullet) {
        const pitch = ln.top - cur.bottom, sameSize = Math.abs(ln.size - cur.size) < 1.2;
        const indentNew = ln.x0 > cur.lastX0 + 1.2 * ln.size && endsSentence(cur.text);
        const shortPrev = cur.lastX1 < cur.blockR - 0.15 * (cur.blockR - cur.x0) && endsSentence(cur.text);
        join = pitch < 0.75 * ln.size && sameSize && !indentNew && !shortPrev && !/\t/.test(ln.text) && !/\t/.test(cur.text.slice(-60));
        if (join && cur.heading) join = ln.size >= bodySize * 1.1;           // consecutive heading lines belong together, body lines do not
      }
      if (join) {
        const prevT = cur.text, hy = /[A-Za-zÀ-ɏ]-$/.test(prevT) && /^[a-zß-ÿ]/.test(ln.text);
        if (hy) { cur.runs[cur.runs.length - 1].t = cur.runs[cur.runs.length - 1].t.replace(/-$/, ''); cur.runs = mergeRuns(cur.runs, ln.runs, ''); cur.text = prevT.replace(/-$/, '') + ln.text; }
        else { cur.runs = mergeRuns(cur.runs, ln.runs, ' '); cur.text = prevT + ' ' + ln.text; }
        cur.x0 = Math.min(cur.x0, ln.x0); cur.x1 = Math.max(cur.x1, ln.x1); cur.bottom = ln.bottom; cur.lastX0 = ln.x0; cur.lastX1 = ln.x1; cur.lines++;
      } else {
        cur = { kind: 'p', x0: ln.x0, x1: ln.x1, top: ln.top, bottom: ln.bottom, size: ln.size, runs: ln.runs.map(r => Object.assign({}, r)), text: ln.text, lastX0: ln.x0, lastX1: ln.x1, blockR, lines: 1, list: bullet };
        paras.push(cur);
      }
    }
    paras.forEach(p => { p.x1 = Math.max(p.x1, p.x0 + 1); delete p.lastX0; delete p.lastX1; delete p.blockR; });
    return paras;
  }

  /* Build the reading-order block list of one page. */
  function pageBlocks(raw, bodyHint) {
    const lines = buildLines(raw.items);
    const msize = med(lines.map(l => l.size));
    const { tables, rest } = findTables(lines, raw.W);
    // atoms: one per segment, plus whole tables and pictures
    const atoms = [];
    let lid = 0;
    rest.forEach(L => { const id = lid++; L.segs.forEach(s => atoms.push({ kind: 'seg', lid: id, x0: s.x0, x1: s.x1, top: s.y - s.size * 0.85, bottom: s.y + s.size * 0.25, runs: s.runs, text: s.text, size: s.size })); });
    tables.forEach(t => atoms.push(t));
    raw.images.forEach(im => atoms.push(Object.assign({ kind: 'img' }, im)));
    const groups = flagGroups(xyCut(atoms, msize, 0));
    const blocks = [];
    for (const g of groups) {
      const sorted = g.slice().sort((a, b) => a.top - b.top || a.x0 - b.x0);
      let i = 0, hard = g.hard;
      while (i < sorted.length) {
        const a = sorted[i];
        if (a.kind !== 'seg') { blocks.push(a); i++; hard = false; continue; }
        // collect consecutive text atoms, rebuilding lines
        const run = []; while (i < sorted.length && sorted[i].kind === 'seg') run.push(sorted[i++]);
        const byLine = new Map(); run.forEach(s => { if (!byLine.has(s.lid)) byLine.set(s.lid, []); byLine.get(s.lid).push(s); });
        const ls = [...byLine.values()].map(a2 => lineOf(a2)).sort((p, q) => p.top - q.top);
        if (ls.length) ls[0].hard = hard;
        hard = false;
        paragraphs(ls, bodyHint || msize, raw.W).forEach(p => blocks.push(p));
      }
    }
    return { blocks, lines, tables, msize };
  }

  /* text colour: the pixel inside each text box that differs most from the colour beside it */
  function colorize(cv, k, items) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const img = g.getImageData(0, 0, W, H).data;
    const at = (x, y) => { x = Math.max(0, Math.min(W - 1, x | 0)); y = Math.max(0, Math.min(H - 1, y | 0)); const i = (y * W + x) * 4; return [img[i], img[i + 1], img[i + 2]]; };
    const q = v => v < 70 ? 0 : v > 200 ? 255 : Math.round(v / 32) * 32;
    items.forEach(it => {
      const x0 = it.x * k, x1 = (it.x + it.w) * k, t = (it.y - it.size * 0.8) * k, b = (it.y + it.size * 0.1) * k;
      const bg = at(x0 - 3, (t + b) / 2); let bestD = 0, best = null;
      const nx = Math.min(14, Math.max(2, Math.round((x1 - x0) / 2))), ny = 5;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const c = at(x0 + (x1 - x0) * (i + 0.5) / nx, t + (b - t) * (j + 0.5) / ny), d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
        if (d > bestD) { bestD = d; best = c; }
      }
      let c = best;
      if (!c || bestD < 90) { const lum = bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11; c = lum < 110 ? [255, 255, 255] : [0, 0, 0]; }
      const chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
      if (chroma < 45) { const lum = bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11; c = lum < 128 ? [255, 255, 255] : [0, 0, 0]; }     // grey = anti-aliased black/white text
      const h = v => ('0' + q(v).toString(16)).slice(-2);
      it.color = (h(c[0]) + h(c[1]) + h(c[2])).toUpperCase();
    });
  }

  /* paint over every piece of text with the colour next to it, so what is left is the page's graphics and colours */
  function whiten(cv, k, items) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const img = g.getImageData(0, 0, W, H).data;
    const px = (x, y) => { x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y))); const i = (y * W + x) * 4; return [img[i], img[i + 1], img[i + 2]]; };
    items.forEach(it => {
      const x0 = (it.x - 1.5) * k, x1 = (it.x + it.w + 1.5) * k, t = (it.y - it.size * 0.92) * k, b = (it.y + it.size * 0.28) * k, my = (t + b) / 2;
      const a = px(x0 - 3, my), c = px(x1 + 3, my), d = Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]);
      const col = d < 45 ? [(a[0] + c[0]) >> 1, (a[1] + c[1]) >> 1, (a[2] + c[2]) >> 1] : (a[0] + a[1] + a[2] > c[0] + c[1] + c[2] ? a : c);
      g.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')'; g.fillRect(x0, t, x1 - x0, b - t);
    });
  }

  /* ───────── 5. whole-document pass ───────── */
  C.analyze = async function (pdf, opt, ctx) {
    opt = opt || {}; ctx = ctx || {};
    const n = pdf.numPages, prog = ctx.progress || (() => {});
    const pages = [], sizeVotes = {}; let chars = 0;
    const maxImgBytes = (PL.env && PL.env.mobile ? 120 : 400) * 1048576; let imgBytes = 0, imgSkipped = 0;
    for (let p = 1; p <= n; p++) {
      PL.abortIf(ctx); prog(0.05 + 0.5 * (p - 1) / n, 'reading page ' + p + '/' + n);
      const raw = await rawPage(pdf, p, opt);
      const wantPics = opt.images !== false;
      let rend = null;                                                   // one render per page: colours, picture crops, slide background
      if (opt.colors || opt.bg || (wantPics && raw.images.length)) { try { rend = await PL.renderPage(raw.page, opt.scale || 2, PL.env.maxCanvasPx); } catch (e) { rend = null; } }
      if (rend && opt.colors) { try { colorize(rend.cv, rend.vp.width / raw.W, raw.items); } catch (e) { /* colours are a nicety */ } }
      const pm = pageBlocks(raw, null);
      pm.W = raw.W; pm.H = raw.H; pm.no = p; pm.raw = raw;
      pm.chars = raw.items.reduce((a, i) => a + i.str.replace(/\s/g, '').length, 0);
      chars += pm.chars;
      pm.lines.forEach(l => { const k = Math.round(l.size * 2) / 2; sizeVotes[k] = (sizeVotes[k] || 0) + l.chars; });
      // scanned / image-only page?
      const area = raw.W * raw.H;
      pm.big = raw.images.filter(im => (im.x1 - im.x0) * (im.bottom - im.top) > 0.8 * area);
      pm.scanned = pm.chars < 12 && raw.images.length > 0;
      // pictures: crop them from a render of the page
      let imgs = pm.blocks.filter(b => b.kind === 'img');
      if (pm.chars >= 12) imgs = imgs.filter(im => (im.x1 - im.x0) * (im.bottom - im.top) <= 0.8 * area);   // OCR'd scan backgrounds are not pictures
      pm.blocks = pm.blocks.filter(b => b.kind !== 'img' || imgs.includes(b));
      if (pm.scanned && wantPics) { pm.blocks = [{ kind: 'img', x0: 0, x1: raw.W, top: 0, bottom: raw.H, full: true }]; imgs = pm.blocks; }
      if (!wantPics && !opt.bg) pm.blocks = pm.blocks.filter(b => b.kind !== 'img');
      else if (rend && (imgs.length || opt.bg)) {
        try {
          const cv = rend.cv, k = rend.vp.width / raw.W;
          for (const im of imgs.length ? imgs : []) {
            if (imgBytes > maxImgBytes) { imgSkipped++; im.skip = true; continue; }
            const cw = Math.max(1, Math.round((im.x1 - im.x0) * k)), ch = Math.max(1, Math.round((im.bottom - im.top) * k));
            const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
            c2.getContext('2d').drawImage(cv, Math.round(im.x0 * k), Math.round(im.top * k), cw, ch, 0, 0, cw, ch);
            const blob = await PL.canvasToBlob(c2, 'image/jpeg', 0.88); PL.freeCanvas(c2);
            im.bytes = new Uint8Array(await blob.arrayBuffer()); im.mime = 'image/jpeg'; im.wpx = cw; im.hpx = ch; imgBytes += im.bytes.length;
          }
          pm.blocks = pm.blocks.filter(b => b.kind !== 'img' || b.bytes);
          if (opt.bg === 'whiten' || opt.bg === 'page') {                   // PowerPoint backgrounds
            if (opt.bg === 'whiten') whiten(cv, k, raw.items);
            const blob = await PL.canvasToBlob(cv, 'image/jpeg', opt.bgQuality || 0.82);
            pm.bgBytes = new Uint8Array(await blob.arrayBuffer());
          }
        } catch (e) { pm.blocks = pm.blocks.filter(b => b.kind !== 'img'); }
      } else if (!rend) pm.blocks = pm.blocks.filter(b => b.kind !== 'img');
      if (rend) PL.freeCanvas(rend.cv);
      delete pm.raw.page; raw.page = null;
      pages.push(pm);
      if (p % 5 === 0) await PL.tick();
    }
    // body font size = the size with most characters
    let body = 10, bestV = -1; Object.keys(sizeVotes).forEach(k => { if (sizeVotes[k] > bestV) { bestV = sizeVotes[k]; body = +k; } });
    // repeated headers / footers / page numbers
    const hf = new Map(), norm = t => t.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
    const zone = (pm, b) => b.bottom < pm.H * 0.075 || b.top > pm.H * 0.925;
    pages.forEach(pm => { const seen = new Set(); pm.blocks.forEach(b => { if (b.kind === 'p' && zone(pm, b)) { const k = norm(b.text); if (!seen.has(k)) { seen.add(k); hf.set(k, (hf.get(k) || 0) + 1); } } }); });
    let removedHF = 0;
    if (opt.hf !== false && n >= 2) {
      pages.forEach(pm => {
        pm.blocks = pm.blocks.filter(b => {
          if (b.kind !== 'p' || !zone(pm, b)) return true;
          const k = norm(b.text), cnt = hf.get(k) || 0;
          const pageNo = /^(page\s*)?#(\s*(of|\/)\s*#)?$/.test(k) || /^[-–—\s]*#[-–—\s]*$/.test(k);
          if (pageNo || (cnt >= Math.max(2, Math.ceil(n * 0.5)) && b.text.length < 120)) { removedHF++; return false; }
          return true;
        });
      });
    }
    // headings
    pages.forEach(pm => pm.blocks.forEach(b => {
      if (b.kind !== 'p') return;
      const r = b.size / body, allBold = b.runs.length && b.runs.every(x => x.b);
      b.heading = 0;
      if (b.text.length < 160 && !b.list) {
        if (r >= 1.6) b.heading = 1; else if (r >= 1.3) b.heading = 2; else if (r >= 1.13) b.heading = 3;
        else if (allBold && r >= 0.98 && b.text.length < 80 && !/[.,;]$/.test(b.text.trim()) && b.lines <= 2) b.heading = 4;
      }
      const mid = (b.x0 + b.x1) / 2;
      b.center = b.lines <= 3 && Math.abs(mid - pm.W / 2) < 0.025 * pm.W && b.x0 > 0.12 * pm.W && b.x1 < 0.88 * pm.W && b.heading > 0;
    }));
    return { pages, body, chars, removedHF, imgSkipped, scannedPages: pages.filter(p => p.scanned).length, tableCount: pages.reduce((a, p) => a + p.blocks.filter(b => b.kind === 'table').length, 0) };
  };

  C._num = function (s) {                         // text → { v, fmt } for Excel, or null when it is really text
    let t = String(s).trim(); if (!t) return null;
    let neg = false, pct = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/%\s*$/.test(t)) { pct = true; t = t.replace(/%\s*$/, ''); }
    t = t.replace(/^[\s$€£¥₹]+|[\s$€£¥₹]+$/g, '').replace(/^(Rs\.?|INR|USD|EUR|GBP)\s*/i, '');
    if (/^[-\u2212]/.test(t)) { t = t.replace(/^[-\u2212]\s*/, ''); neg = true; }
    const grouped = /^\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(t), plain = /^\d+(\.\d+)?$/.test(t);
    if (!grouped && !plain) return null;
    if (/^0\d/.test(t) && !/^0\./.test(t)) return null;                    // 007, zip codes, phone numbers
    const digits = t.replace(/[,.]/g, '');
    if (digits.length > 15) return null;
    let v = parseFloat(t.replace(/,/g, '')); if (!isFinite(v)) return null;
    if (neg) v = -v; if (pct) v /= 100;
    const dec = (t.split('.')[1] || '').length;
    return { v, fmt: pct ? (dec ? 'pct2' : 'pct0') : grouped ? (dec ? 'num2' : 'num0') : null };
  };
})(window.PaperLab);
