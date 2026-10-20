/* Patram — Compress to a target size (100 KB / 200 KB / 300 KB / 1 MB / custom) — fully local.

   Strategy, gentlest first, stopping as soon as the file fits:
     1. Already small enough            → return the original untouched.
     2. Re-encode embedded images       → text, links & vectors stay exactly as they were (searchable / selectable).
                                          Each image gets a byte budget proportional to its pixel area; a quality+scale
                                          search finds the best picture that fits that budget.
     3. Flatten pages to JPEG           → last resort, only if the user allows it (text stops being selectable).
                                          Page size is preserved; each page gets a dynamic byte budget.
   If even the smallest settings cannot reach the target, the closest result is returned and flagged — never a silent failure.

   Manual mode (no target) keeps the classic "Strength / Resolution" rasterise behaviour. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const C = PL.compress = {};
  const KB = 1024, noop = () => {};
  const SAFETY = 0.97;                       // aim slightly under the target (container overhead, rounding)

  C.TARGETS = [['100', '100 KB'], ['200', '200 KB'], ['300', '300 KB'], ['1024', '1 MB']];

  /* ui options → target in bytes (0 = manual mode) */
  C.targetBytes = function (o) {
    const m = String(o && o.mode != null ? o.mode : 'manual');
    if (m === 'manual') return 0;
    const kb = parseFloat(m === 'custom' ? o.custom : m);
    if (!(kb > 0)) throw new Error('Enter a target size in KB (for example 150)');
    return Math.round(kb * KB);
  };
  C.fmtTarget = function (b) { return b >= 1048576 && b % 1048576 === 0 ? (b / 1048576) + ' MB' : Math.round(b / KB) + ' KB'; };

  /* ───────── JPEG budget search ───────── */
  const encodeJpeg = async (cv, q) => new Uint8Array(await (await PL.canvasToBlob(cv, 'image/jpeg', q)).arrayBuffer());

  function scaledCanvas(src, f, gray) {
    const w = Math.max(8, Math.round(src.width * f)), h = Math.max(8, Math.round(src.height * f));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);                 // flatten any transparency onto white
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    if (gray) {                                                    // manual loop: ctx.filter is missing in older Safari
      const id = g.getImageData(0, 0, w, h), d = id.data;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = d[i + 1] = d[i + 2] = l; }
      g.putImageData(id, 0, 0);
    }
    return cv;
  }

  /* Largest quality whose JPEG still fits `budget` (log-size interpolation: ~3 encodes typically). */
  async function searchQuality(cv, budget) {
    const QMIN = 0.28, QMAX = 0.92;
    let q = 0.6, best = null, lo = null, hi = null, smallest = null, first = 0;
    for (let i = 0; i < 7; i++) {
      const bytes = await encodeJpeg(cv, q), size = bytes.length;
      if (!first) first = size;
      if (!smallest || size < smallest.bytes.length) smallest = { q, bytes };
      if (size <= budget) { if (!best || q > best.q) best = { q, bytes }; if (!lo || q > lo.q) lo = { q, size }; }
      else if (!hi || q < hi.q) hi = { q, size };
      if (best && (best.bytes.length >= budget * 0.86 || q >= QMAX - 0.001)) break;
      let next;
      if (lo && hi && hi.q > lo.q) {
        if (hi.q - lo.q < 0.02) break;
        const t = (Math.log(budget * 0.94) - Math.log(lo.size)) / (Math.log(hi.size) - Math.log(lo.size));
        next = lo.q + (hi.q - lo.q) * Math.min(0.9, Math.max(0.1, t));
      } else {
        next = q + Math.log(budget * 0.93 / size) / 3.2;
        if (!lo && q <= QMIN + 0.001) break;                       // already at the floor and still too big
      }
      next = Math.min(QMAX, Math.max(QMIN, next));
      if (Math.abs(next - q) < 0.008) break;
      q = next;
    }
    return best ? { ok: true, q: best.q, bytes: best.bytes, first } : { ok: false, q: smallest.q, bytes: smallest.bytes, first };
  }

  /* Fit a canvas/bitmap into `budget` bytes by walking down a ladder of (scale, grayscale) steps.
     opts: { allowGray, gray } → { ok, bytes, width, height, gray, scale, q } */
  C.fit = async function (src, budget, opts) {
    opts = opts || {};
    const ladder = [];
    if (opts.gray) [1, .85, .7, .55, .45, .35, .27, .2].forEach(f => ladder.push([f, true]));
    else {
      [1, .85, .7].forEach(f => ladder.push([f, false]));
      if (opts.allowGray) [.7, .55, .45, .35, .27, .2].forEach(f => ladder.push([f, true]));
      else [.55, .45, .35, .27, .2].forEach(f => ladder.push([f, false]));
    }
    let last = null;
    if (opts.minimal) ladder.splice(0, ladder.length - 1);                // hopeless target → just do the smallest rung
    let ref = null;                                                      // bytes-per-source-pixel at q=.6, from the first rung we actually encode
    for (let li = 0; li < ladder.length; li++) {
      const [f, gray] = ladder[li];
      if (ref && li < ladder.length - 1) {
        const pred = ref.density * src.width * src.height * f * f * (gray && !ref.gray ? 0.55 : 1);
        if (pred * 0.4 > budget) continue;                               // even at the lowest quality this rung would not fit
      }
      const cv = scaledCanvas(src, f, gray);
      const r = await searchQuality(cv, budget);
      if (!ref) ref = { density: r.first / (cv.width * cv.height / (f * f)), gray };
      const out = { ok: r.ok, bytes: r.bytes, width: cv.width, height: cv.height, gray, scale: f, q: r.q };
      PL.freeCanvas(cv);
      if (r.ok) return out;
      if (!last || out.bytes.length < last.bytes.length) last = out;
      await PL.tick();
    }
    return last;
  };

  /* ───────── 2. embedded-image recompression (keeps text) ───────── */
  const DROP_KEYS = ['/Filter', '/DecodeParms', '/Length', '/Width', '/Height', '/ColorSpace', '/BitsPerComponent', '/Decode', '/DL', '/Intent'];

  function filterName(L, stream) {
    const f = stream.dict.lookup(L.PDFName.of('Filter'));
    if (f instanceof L.PDFName) return f.asString().slice(1);
    if (f instanceof L.PDFArray && f.size() === 1) { const n = f.lookup(0); return n instanceof L.PDFName ? n.asString().slice(1) : null; }
    return null;
  }
  function colorKind(L, stream) {
    const cs = stream.dict.lookup(L.PDFName.of('ColorSpace'));
    if (cs instanceof L.PDFName) {
      const n = cs.asString().slice(1);
      return n === 'DeviceRGB' || n === 'CalRGB' ? 'rgb' : n === 'DeviceGray' || n === 'CalGray' ? 'gray' : null;
    }
    if (cs instanceof L.PDFArray && cs.size() >= 2) {
      const nm = cs.lookup(0);
      if (nm instanceof L.PDFName && nm.asString() === '/ICCBased') {
        const prof = cs.lookup(1);
        const n = prof && prof.dict && prof.dict.lookup(L.PDFName.of('N'));
        const k = n && n.asNumber && n.asNumber();
        return k === 3 ? 'rgb' : k === 1 ? 'gray' : null;            // 4 = CMYK → leave alone
      }
    }
    return null;
  }

  function scanImages(doc) {
    const L = PL.lib(), N = s => L.PDFName.of(s);
    const objs = doc.context.enumerateIndirectObjects();
    const maskRefs = new Set();
    objs.forEach(([ref, obj]) => {
      if (obj instanceof L.PDFRawStream && obj.dict.lookup(N('Subtype')) === N('Image')) {
        ['SMask', 'Mask'].forEach(k => { const v = obj.dict.get(N(k)); if (v instanceof L.PDFRef) maskRefs.add(v.toString()); });
      }
    });
    const out = [];
    objs.forEach(([ref, obj]) => {
      if (!(obj instanceof L.PDFRawStream)) return;
      const d = obj.dict;
      if (d.lookup(N('Subtype')) !== N('Image')) return;
      if (maskRefs.has(ref.toString())) return;                      // soft masks must stay DeviceGray
      const im = d.lookup(N('ImageMask')); if (im && im.toString() === 'true') return;
      if (d.lookup(N('Mask')) instanceof L.PDFArray) return;         // colour-key mask would break under lossy JPEG
      if (d.lookup(N('Decode'))) return;                             // inverted / remapped samples
      const bpc = d.lookup(N('BitsPerComponent')); if (!bpc || bpc.asNumber() !== 8) return;
      const kind = filterName(L, obj); if (kind !== 'DCTDecode' && kind !== 'FlateDecode') return;
      const cs = colorKind(L, obj); if (!cs) return;
      const w = d.lookup(N('Width')).asNumber(), h = d.lookup(N('Height')).asNumber();
      if (!(w > 8 && h > 8)) return;
      const len = obj.getContents().length;
      if (len < 4096) return;                                        // tiny icons: nothing to win
      out.push({ ref, stream: obj, kind: kind === 'DCTDecode' ? 'dct' : 'flate', cs, w, h, area: w * h, len });
    });
    return out;
  }

  async function bitmapOf(blob, maxPx) {
    const opt = { imageOrientation: 'none', colorSpaceConversion: 'none' };
    let bmp;
    try { bmp = await createImageBitmap(blob, opt); } catch (e) { bmp = await createImageBitmap(blob); }
    if (bmp.width * bmp.height > maxPx) {                            // huge scans: decode straight to a manageable size
      const k = Math.sqrt(maxPx / (bmp.width * bmp.height));
      const rw = Math.max(8, Math.floor(bmp.width * k)), rh = Math.max(8, Math.floor(bmp.height * k));
      bmp.close && bmp.close();
      try { bmp = await createImageBitmap(blob, { ...opt, resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' }); }
      catch (e) { bmp = await createImageBitmap(blob, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' }); }
    }
    return bmp;
  }

  async function decodeCandidate(L, c) {
    const maxPx = PL.env.maxCanvasPx;
    if (c.kind === 'dct') {
      const bmp = await bitmapOf(new Blob([c.stream.getContents()], { type: 'image/jpeg' }), maxPx);
      return { src: bmp, free: () => bmp.close && bmp.close() };
    }
    if (c.area > maxPx) throw new Error('image too large to decode on this device');
    const raw = L.decodePDFRawStream(c.stream).decode();
    const n = c.cs === 'rgb' ? 3 : 1;
    if (raw.length < c.area * n) throw new Error('unexpected image data length');
    const cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
    const g = cv.getContext('2d'), id = g.createImageData(c.w, c.h), d = id.data;
    if (n === 3) for (let i = 0, j = 0, k = 0; i < c.area; i++) { d[j++] = raw[k++]; d[j++] = raw[k++]; d[j++] = raw[k++]; d[j++] = 255; }
    else for (let i = 0, j = 0; i < c.area; i++) { const v = raw[i]; d[j++] = v; d[j++] = v; d[j++] = v; d[j++] = 255; }
    g.putImageData(id, 0, 0);
    return { src: cv, free: () => PL.freeCanvas(cv) };
  }

  function putJpeg(doc, c, r) {
    const L = PL.lib(), N = s => L.PDFName.of(s);
    const nd = L.PDFDict.withContext(doc.context);
    c.stream.dict.entries().forEach(([k, v]) => { if (DROP_KEYS.indexOf(k.asString()) < 0) nd.set(k, v); });
    nd.set(N('Filter'), N('DCTDecode'));
    nd.set(N('Width'), L.PDFNumber.of(r.width)); nd.set(N('Height'), L.PDFNumber.of(r.height));
    nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('BitsPerComponent'), L.PDFNumber.of(8));
    doc.context.assign(c.ref, L.PDFRawStream.of(nd, r.bytes));
    c.replaced = r.bytes.length;
  }

  async function viaImages(bytes, target, o, ctx) {
    const L = PL.lib(), prog = ctx.progress || noop;
    const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
    const cands = scanImages(doc);
    if (!cands.length) return null;
    const imgTotal = cands.reduce((n, c) => n + c.len, 0);
    const baseSave = await doc.save({ useObjectStreams: true });
    let fixed = Math.max(0, baseSave.length - imgTotal);              // everything that is not an image (text, fonts, structure)
    cands.sort((a, b) => b.area - a.area);
    let best = baseSave.length < bytes.length ? { bytes: baseSave, replacedN: 0 } : null;
    const sumArea = cands.reduce((n, c) => n + c.area, 0);
    let last = Infinity;

    for (let round = 0; round < 3; round++) {
      cands.forEach(c => { if (c.replaced) { doc.context.assign(c.ref, c.stream); c.replaced = 0; } });   // back to the originals
      const budgetAll = Math.max(target * SAFETY - fixed, cands.length * 2500);
      let remaining = budgetAll, remArea = sumArea, n = 0;
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        PL.abortIf(ctx);
        prog((round + i / cands.length) / 3, 'image ' + (i + 1) + '/' + cands.length + (round ? ' (pass ' + (round + 1) + ')' : ''));
        const share = Math.max(2000, remaining * c.area / remArea);
        remArea -= c.area;
        if (c.len <= share) { remaining -= c.len; continue; }          // already small enough → leave it alone
        try {
          const dec = await decodeCandidate(L, c);
          let r;
          try { r = await C.fit(dec.src, share, { allowGray: o.gray !== false && o.gray !== 'false', gray: c.cs === 'gray' }); }
          finally { dec.free(); }
          if (r && r.bytes.length < c.len * 0.98) { putJpeg(doc, c, r); remaining -= r.bytes.length; n++; }
          else remaining -= c.len;
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          remaining -= c.len;                                          // undecodable → keep original
        }
        await PL.tick();
      }
      const out = await doc.save({ useObjectStreams: true });
      if (!best || out.length < best.bytes.length) best = { bytes: out, replacedN: n };
      if (out.length <= target) return { bytes: out, replacedN: n, reached: true };
      if (out.length >= last * 0.995) break;                           // no progress → stop
      last = out.length;
      const imgNow = cands.reduce((s, c) => s + (c.replaced || c.len), 0);
      fixed = Math.max(0, out.length - imgNow);                        // use the measured overhead next round
    }
    return best ? { bytes: best.bytes, replacedN: best.replacedN, reached: best.bytes.length <= target } : null;
  }

  /* ───────── 3. flatten pages (target or manual) ───────── */
  async function viaRaster(bytes, o, ctx, plan) {
    const L = PL.lib(), prog = ctx.progress || noop;
    const pdf = await PL.openPdfjs(bytes);
    try {
      const n = pdf.numPages;
      const rounds = plan.target ? 3 : 1;
      let shrink = 1, bestOut = null, notes = [];
      for (let round = 0; round < rounds; round++) {
        const doc = await L.PDFDocument.create();
        let remaining = plan.target ? plan.target * SAFETY * shrink - 900 - n * 350 : 0, grayUsed = 0, minScale = 1, allOk = true, fails = 0;
        for (let i = 1; i <= n; i++) {
          PL.abortIf(ctx);
          prog((round + (i - 1) / n) / rounds, 'page ' + i + '/' + n + (round ? ' (pass ' + (round + 1) + ')' : ''));
          const page = await pdf.getPage(i);
          const vp1 = page.getViewport({ scale: 1 });
          const longest = Math.max(vp1.width, vp1.height);
          const scale = plan.target
            ? Math.min(200 / 72, (PL.env.mobile ? 2600 : 3600) / longest)                 // ≈200 dpi, capped by device
            : plan.scale;
          const { cv } = await PL.renderPage(page, scale);
          page.cleanup();
          let jpg;
          if (plan.target) {
            const budget = Math.max(1500, remaining / (n - i + 1));
            const r = await C.fit(cv, budget, { allowGray: o.gray !== false && o.gray !== 'false', minimal: fails >= 2 });
            jpg = r.bytes; if (!r.ok) { allOk = false; fails++; } if (r.gray) grayUsed++; minScale = Math.min(minScale, r.scale);
            remaining -= jpg.length;
          } else {
            jpg = new Uint8Array(await (await PL.canvasToBlob(cv, 'image/jpeg', plan.q)).arrayBuffer());
          }
          PL.freeCanvas(cv);
          const img = await doc.embedJpg(jpg);
          const p = doc.addPage([vp1.width, vp1.height]);                                  // keep the original page size
          p.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
          await PL.tick();
        }
        const out = await doc.save({ useObjectStreams: true });
        if (!bestOut || out.length < bestOut.bytes.length) bestOut = { bytes: out, grayUsed, minScale, allOk };
        if (!plan.target || out.length <= plan.target || !allOk) break;          // fits, or cannot get smaller → no more passes
        shrink *= Math.max(0.5, (plan.target * SAFETY) / out.length);
      }
      return bestOut;
    } finally { pdf.destroy(); }
  }

  /* ───────── public entry ───────── */
  C.toTarget = async function (bytes, target, o, ctx) {
    ctx = ctx || {};
    const L = PL.lib(), label = C.fmtTarget(target), sz = PL.fmtBytes;
    if (bytes.length <= target) {
      return { bytes, skipped: true, reached: true, method: 'none', note: 'already ' + sz(bytes.length) + ' — under ' + label + ', unchanged' };
    }
    let imgRes = null;
    try { imgRes = await viaImages(bytes, target, o, ctx); }
    catch (e) { if (e && e.name === 'AbortError') throw e; imgRes = null; }          // odd structure → try the raster route
    if (imgRes) {                                                                     // sanity: must re-open cleanly
      try { await L.PDFDocument.load(imgRes.bytes, { updateMetadata: false }); } catch (e) { imgRes = null; }
    }
    if (imgRes && imgRes.reached) {
      return { bytes: imgRes.bytes, reached: true, method: 'images',
        note: sz(bytes.length) + ' → ' + sz(imgRes.bytes.length) + ' (target ' + label + ') · ' + imgRes.replacedN + ' image(s) re-encoded, text kept' };
    }
    const allowRaster = o.raster !== false && o.raster !== 'false';
    if (allowRaster) {
      const r = await viaRaster(bytes, o, ctx, { target });
      const ok = r.bytes.length <= target;
      return { bytes: r.bytes, reached: ok, method: 'raster',
        note: sz(bytes.length) + ' → ' + sz(r.bytes.length) + ' (target ' + label + (ok ? '' : ' — not reachable, this is the smallest possible') + ') · pages flattened to images' +
              (r.grayUsed ? ', grayscale' : '') + (r.minScale < 1 ? ', ' + Math.round(r.minScale * 100) + '% resolution' : '') };
    }
    if (imgRes && imgRes.bytes.length < bytes.length) {
      return { bytes: imgRes.bytes, reached: false, method: 'images',
        note: sz(bytes.length) + ' → ' + sz(imgRes.bytes.length) + ' — could not reach ' + label + ' while keeping text. Allow flattening pages to go lower.' };
    }
    return { bytes, skipped: true, reached: false, method: 'none',
      note: 'could not reach ' + label + ' while keeping text (nothing to shrink). Allow flattening pages to go lower.' };
  };

  C.manual = async function (bytes, o, ctx) {
    ctx = ctx || {};
    const r = await viaRaster(bytes, o, ctx, { scale: +o.dpi || 1.3, q: +o.q || 0.6 });
    if (o.keep && r.bytes.length >= bytes.length) return { bytes, note: 'kept original (already optimal)', skipped: true };
    return { bytes: r.bytes };
  };

  /* ───────── op (used by the single tool AND Mass Batch) ───────── */
  PL.ops.compress = {
    id: 'compress', label: 'Compress (to a target size)', group: 'Optimize', accepts: ['pdf'], suffix: '-compressed', ext: 'pdf',
    fields: [
      { id: 'mode', label: 'Target size', type: 'select', value: '300', options: C.TARGETS.concat([['custom', 'Custom size…'], ['manual', 'Manual (strength)']]) },
      { id: 'custom', label: 'Custom target (KB)', type: 'number', value: '150', min: 10, showIf: ['mode', 'custom'] },
      { id: 'q', label: 'Strength', type: 'select', value: '0.6', showIf: ['mode', 'manual'], options: [['0.6', 'Balanced'], ['0.4', 'Smaller'], ['0.8', 'Light']] },
      { id: 'dpi', label: 'Resolution', type: 'select', value: '1.3', showIf: ['mode', 'manual'], options: [['1.3', 'Standard'], ['1', 'Low'], ['1.8', 'High']] },
      { id: 'raster', label: 'If needed, flatten pages to images (text stops being selectable)', type: 'check', value: true, showNotIf: ['mode', 'manual'] },
      { id: 'gray', label: 'If needed, convert to grayscale', type: 'check', value: true, showNotIf: ['mode', 'manual'] },
      { id: 'keep', label: 'Keep original if result is not smaller', type: 'check', value: true }
    ],
    note: 'Pick a size and Patram finds the best quality that fits. Images are re-encoded first so text stays selectable; flattening pages is only a last resort. Run Searchable (OCR) afterwards if you need text back.',
    async run(bytes, o, ctx) {
      o = o || {};
      const target = C.targetBytes(o);
      const r = target ? await C.toTarget(bytes, target, o, ctx) : await C.manual(bytes, o, ctx);
      if (target && o.keep !== false && o.keep !== 'false' && r.bytes.length >= bytes.length && !r.skipped) {
        return { bytes, skipped: true, note: 'kept original — could not make it smaller' };
      }
      return r;
    }
  };
})(window.PaperLab);
