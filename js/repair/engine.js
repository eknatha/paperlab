/* PaperLab — Repair a damaged PDF, 100% in the browser.

   Ladder (stops at the first rung whose output passes verification):
     1. LIGHT    pdf-lib reads the file as-is and writes it back with a fresh cross-reference table.
     2. REBUILD  scan the raw bytes for every "N G obj … endobj", unpack object streams, throw away broken
                 or half-written objects, find (or synthesise) the Catalog / page tree, write a clean classic
                 file, then let pdf-lib normalise it.
     3. SALVAGE  copy page by page into a new document; pages that cannot be copied or fail to interpret are dropped.
     4. IMAGES   (optional) render whatever pdf.js can still draw and rebuild those pages as images.
   "Verify" = pdf.js interprets every page's operator list. A page that throws is not counted as recovered.

   Honest limits: bytes that are physically gone (a truncated tail, a zeroed content stream) cannot be invented.
   Encrypted files need their password and are refused. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const R = PL.repair = {};
  const noop = () => {};

  function latin1(u8, a, b) {
    a = a || 0; b = b == null ? u8.length : b;
    let s = '';
    for (let i = a; i < b; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(b, i + 32768)));
    return s;
  }
  function bytesOf(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
  const pad = (n, w) => String(n).padStart(w, '0');

  /* ───────── 1. read the raw structure ───────── */
  R.scan = function (u8) {
    const s = latin1(u8);
    const issues = [];
    const hdr = s.indexOf('%PDF-');
    if (hdr < 0) issues.push('The "%PDF-" header is missing');
    else if (hdr > 0) issues.push('Junk bytes before the PDF header (' + hdr + ' bytes)');
    const tail = s.slice(-2048);
    if (!/%%EOF\s*$/.test(tail)) issues.push('No end-of-file marker — the file looks truncated');
    const sx = /startxref\s+(\d+)/g; let m, lastSx = null;
    while ((m = sx.exec(tail))) lastSx = +m[1];
    if (lastSx == null) issues.push('No "startxref" pointer');
    else {
      const at = hdr > 0 ? lastSx + hdr : lastSx;
      const here = s.slice(at, at + 40);
      if (!/^\s*(xref|\d+\s+\d+\s+obj)/.test(here)) issues.push('The cross-reference table points to the wrong place');
    }

    const re = /(?:^|[\s>\]])(\d{1,10})[ \t\r\n]+(\d{1,5})[ \t\r\n]+obj(?![A-Za-z])/g;
    const marks = [];
    while ((m = re.exec(s))) marks.push({ num: +m[1], gen: +m[2], off: m.index + m[0].indexOf(m[1]) });
    const recs = [];
    for (let i = 0; i < marks.length; i++) {
      const mk = marks[i], limit = i + 1 < marks.length ? marks[i + 1].off : s.length;
      const e = s.lastIndexOf('endobj', limit - 1);
      const complete = e >= mk.off;
      const hdrEnd = mk.off + s.slice(mk.off, mk.off + 40).indexOf('obj') + 3;
      const stop = complete ? e : limit;
      let st = -1;
      for (let k = s.indexOf('stream', hdrEnd); k >= 0 && k < stop; k = s.indexOf('stream', k + 6)) {
        if (s.charCodeAt(k - 1) === 100 /* d: endstream */) continue;
        const c = s.charCodeAt(k + 6);
        if (c === 10 || c === 13) { st = k; break; }
      }
      const dictEnd = st >= 0 ? st : stop;
      const dict = s.slice(hdrEnd, Math.min(dictEnd, hdrEnd + 1500000));
      let dataStart = -1;
      if (st >= 0) { dataStart = st + 6; if (s.charCodeAt(dataStart) === 13 && s.charCodeAt(dataStart + 1) === 10) dataStart += 2; else dataStart += 1; }
      const tm = /\/Type\s*\/([A-Za-z0-9]+)/.exec(dict);
      recs.push({ num: mk.num, gen: mk.gen, off: mk.off, end: complete ? e + 6 : limit, complete, hasStream: st >= 0, dataStart, dict, type: tm ? tm[1] : '', isLast: i === marks.length - 1 });
    }
    // trailer hints (classic trailers and xref-stream dictionaries both carry them)
    let rootHint = null, infoHint = null, enc = /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(s);
    const rr = /\/Root\s+(\d+)\s+\d+\s+R/g, ir = /\/Info\s+(\d+)\s+\d+\s+R/g;
    while ((m = rr.exec(s))) rootHint = +m[1];
    while ((m = ir.exec(s))) infoHint = +m[1];
    // page count the document itself claims (largest /Count of a root-level /Pages node)
    let declared = 0;
    recs.forEach(r => { if (r.type === 'Pages' && !/\/Parent\s+\d/.test(r.dict)) { const c = /\/Count\s+(\d+)/.exec(r.dict); if (c && +c[1] > declared) declared = +c[1]; } });
    return { s, u8, hdr, recs, rootHint, infoHint, encrypted: enc, issues, declared };
  };

  function inflate(bytes) {
    const f = window.fflate;
    try { return f.unzlibSync(bytes); } catch (e) { /* fall through */ }
    try { return f.inflateSync(bytes.subarray(2)); } catch (e) { return null; }
  }

  /* expand "/Type /ObjStm" streams into plain objects */
  function expandObjStms(sc) {
    const out = []; let bad = 0, n = 0;
    sc.recs.forEach(r => {
      if (r.type !== 'ObjStm' || !r.hasStream || !r.complete) return;
      n++;
      if (/\/Predictor/.test(r.dict)) { bad++; return; }
      const stopAt = sc.s.indexOf('endstream', r.dataStart);
      if (stopAt < 0) { bad++; return; }
      let data = sc.u8.subarray(r.dataStart, stopAt);
      const f = /\/Filter\s*(\[\s*)?\/FlateDecode/.test(r.dict);
      let txt;
      if (f) { const d = inflate(data); if (!d) { bad++; return; } txt = latin1(d); }
      else txt = latin1(data);
      const N = +((/\/N\s+(\d+)/.exec(r.dict) || [])[1]), First = +((/\/First\s+(\d+)/.exec(r.dict) || [])[1]);
      if (!N || !First) { bad++; return; }
      const t = txt.slice(0, First).trim().split(/\s+/).map(Number);
      for (let k = 0; k < N; k++) {
        const num = t[2 * k], off = t[2 * k + 1];
        if (!isFinite(num) || !isFinite(off)) break;
        const end = k + 1 < N ? First + t[2 * k + 3] : txt.length;
        out.push({ num, gen: 0, body: txt.slice(First + off, end).trim(), pos: r.off });
      }
    });
    return { objs: out, count: n, bad };
  }

  /* ───────── 2. write a clean classic file from what survived ───────── */
  R.rebuild = function (u8) {
    const sc = R.scan(u8);
    if (sc.encrypted) throw new Error('This PDF is encrypted — repair needs the password removed first');
    if (!sc.recs.length) throw new Error('No PDF objects found — this does not look like a PDF');
    const issues = sc.issues.slice();

    const win = new Map();                         // object number → winner (latest position wins)
    let broken = 0;
    sc.recs.forEach(r => {
      if (r.type === 'XRef' || r.type === 'ObjStm') return;
      let fixLast = false;
      if (!r.complete) {
        if (r.isLast && r.hasStream) fixLast = true;      // truncated tail: close the stream, keep what we have
        else { broken++; return; }
      }
      const cur = win.get(r.num);
      if (!cur || r.off > cur.pos) win.set(r.num, { kind: 'top', rec: r, pos: r.off, fixLast, dict: r.dict, type: r.type });
    });
    const ex = expandObjStms(sc);
    ex.objs.forEach(o => {
      const cur = win.get(o.num);
      if (!cur || o.pos > cur.pos) {
        const tm = /\/Type\s*\/([A-Za-z0-9]+)/.exec(o.body);
        win.set(o.num, { kind: 'cmp', body: o.body, gen: 0, pos: o.pos, dict: o.body, type: tm ? tm[1] : '' });
      }
    });
    if (ex.bad) issues.push(ex.bad + ' compressed object stream(s) could not be unpacked');
    if (broken) issues.push(broken + ' damaged object(s) were discarded');
    if (sc.recs.some(r => !r.complete && r.isLast)) issues.push('The last object was cut off — kept what was readable');

    // page tree
    const get = n => win.get(n);
    const kidsOf = d => { const k = /\/Kids\s*\[([^\]]*)\]/.exec(d); if (!k) return []; const a = []; k[1].replace(/(\d+)\s+\d+\s+R/g, (_, x) => { a.push(+x); }); return a; };
    function leaves(n, depth, seen, acc) {
      const o = get(n); if (!o || depth > 40 || seen.has(n)) return acc;
      seen.add(n);
      if (o.type === 'Pages') kidsOf(o.dict).forEach(k => leaves(k, depth + 1, seen, acc));
      else if (o.type === 'Page') acc.push(n);
      return acc;
    }
    let root = null;
    if (sc.rootHint != null && get(sc.rootHint) && get(sc.rootHint).type === 'Catalog') root = sc.rootHint;
    if (root == null) {
      let best = null; win.forEach((o, n) => { if (o.type === 'Catalog' && (!best || o.pos > best.pos)) best = { n, pos: o.pos }; });
      if (best) root = best.n; else issues.push('The document catalog was missing');
    }
    let reach = [];
    let declared = 0;
    if (root != null) {
      const pr = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(get(root).dict);
      if (pr) { reach = leaves(+pr[1], 0, new Set(), []); const po = get(+pr[1]); const c = po && /\/Count\s+(\d+)/.exec(po.dict); if (c) declared = +c[1]; }
    }
    const allPages = []; win.forEach((o, n) => { if (o.type === 'Page') allPages.push({ n, pos: o.pos }); });
    allPages.sort((a, b) => a.pos - b.pos);
    let max = 0; win.forEach((_, n) => { if (n > max) max = n; });
    const synth = [];
    let synthetic = false;
    if (!reach.length) {
      if (!allPages.length) throw new Error('No pages could be recovered — the page objects are gone');
      issues.push('The page tree was damaged — rebuilt it from ' + allPages.length + ' page object(s)');
      const P = ++max, C = ++max;
      const kids = allPages.map(p => p.n + ' 0 R').join(' ');
      synth.push([P, P + ' 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + allPages.length + ' /MediaBox [0 0 595.28 841.89] >>\nendobj\n']);
      synth.push([C, C + ' 0 obj\n<< /Type /Catalog /Pages ' + P + ' 0 R >>\nendobj\n']);
      root = C; synthetic = true; reach = allPages.map(p => p.n);
    }

    // assemble
    const chunks = []; const offsets = new Map(); let pos = 0;
    const push = b => { chunks.push(b); pos += b.length; };
    push(bytesOf('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'));
    const nums = [...win.keys()].sort((a, b) => a - b);
    nums.forEach(n => {
      const o = win.get(n); offsets.set(n, { off: pos, gen: o.kind === 'top' ? o.rec.gen : 0 });
      if (o.kind === 'top') {
        push(u8.subarray(o.rec.off, o.rec.end));
        if (o.fixLast) push(bytesOf('\nendstream\nendobj'));
        push(bytesOf('\n'));
      } else push(bytesOf(n + ' 0 obj\n' + o.body + '\nendobj\n'));
    });
    synth.forEach(([n, txt]) => { offsets.set(n, { off: pos, gen: 0 }); push(bytesOf(txt)); });
    const size = max + 1, xrefPos = pos;
    let x = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (let n = 1; n < size; n++) {
      const e = offsets.get(n);
      x += e ? pad(e.off, 10) + ' ' + pad(e.gen, 5) + ' n \n' : '0000000000 00000 f \n';
    }
    const info = sc.infoHint != null && win.has(sc.infoHint) ? ' /Info ' + sc.infoHint + ' 0 R' : '';
    x += 'trailer\n<< /Size ' + size + ' /Root ' + root + ' 0 R' + info + ' >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
    push(bytesOf(x));
    const out = new Uint8Array(pos); let p = 0; chunks.forEach(c => { out.set(c, p); p += c.length; });
    return { bytes: out, issues, objects: win.size, pages: reach.length, declared: declared || reach.length, synthetic, objStms: ex.count };
  };

  /* ───────── 3. verification with pdf.js ───────── */
  async function verify(bytes, ctx) {
    let pdf;
    try { pdf = await PL.openPdfjs(bytes); } catch (e) { return { ok: false, pages: 0, bad: [], err: e }; }
    const bad = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        PL.abortIf(ctx);
        try { const pg = await pdf.getPage(i); await pg.getOperatorList(); pg.cleanup(); }
        catch (e) { if (e && e.name === 'AbortError') throw e; bad.push(i - 1); }
        if (i % 10 === 0) await PL.tick();
      }
      return { ok: !bad.length, pages: pdf.numPages, bad };
    } finally { pdf.destroy(); }
  }

  async function copyOut(src, ctx) {
    const { PDFDocument } = PL.lib();
    const out = await PDFDocument.create(); const lost = [];
    const idx = src.getPageIndices();
    for (let i = 0; i < idx.length; i++) {
      PL.abortIf(ctx);
      try { const [p] = await out.copyPages(src, [idx[i]]); out.addPage(p); } catch (e) { lost.push(idx[i]); }
      if (i % 10 === 0) await PL.tick();
    }
    try { const t = src.getTitle(), a = src.getAuthor(); if (t) out.setTitle(t); if (a) out.setAuthor(a); } catch (e) { /* ignore */ }
    return { out, lost };
  }

  async function loadLib(bytes) {
    const { PDFDocument } = PL.lib();
    return PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: false, updateMetadata: false });
  }

  /* last resort: draw each page pdf.js can still render into an image */
  /* true when a rendered page has no visible ink at all (sampled on a 48×64 thumbnail) */
  function isWhite(cv) {
    try {
      const t = document.createElement('canvas'); t.width = 48; t.height = 64;
      const x = t.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, 48, 64); x.drawImage(cv, 0, 0, 48, 64);
      const d = x.getImageData(0, 0, 48, 64).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return false;
      return true;
    } catch (e) { return false; }
  }
  async function viaImages(bytes, ctx, prog) {
    const { PDFDocument } = PL.lib();
    let pdf; try { pdf = await PL.openPdfjs(bytes); } catch (e) { return null; }
    const out = await PDFDocument.create(); let n = 0, empty = 0; const lost = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        PL.abortIf(ctx); prog(i / pdf.numPages, 'drawing page ' + i + '/' + pdf.numPages);
        try {
          const pg = await pdf.getPage(i);
          const base = pg.getViewport({ scale: 1 });
          const { cv } = await PL.renderPage(pg, 2, PL.env.maxCanvasPx);
          if (isWhite(cv)) empty++;
          const blob = await PL.canvasToBlob(cv, 'image/jpeg', 0.85); PL.freeCanvas(cv);
          const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const page = out.addPage([base.width, base.height]); page.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
          pg.cleanup(); n++;
        } catch (e) { if (e && e.name === 'AbortError') throw e; lost.push(i - 1); }
      }
    } finally { pdf.destroy(); }
    return n ? { bytes: await out.save(), pages: n, empty, lost } : null;
  }

  /* ───────── damaged-data handling ───────── */
  function adler32(u) {
    let a = 1, b = 0;
    for (let i = 0; i < u.length;) { const e = Math.min(i + 3800, u.length); for (; i < e; i++) { a += u[i]; b += a; } a %= 65521; b %= 65521; }
    return ((b << 16) | a) >>> 0;
  }
  /* A Flate stream is healthy only if it inflates AND its zlib checksum matches (fflate skips the checksum, which is
     how silently-corrupted data slips through). */
  function flateOk(c) {                                   // → 'ok' | 'suspect' (inflates, checksum differs) | 'bad' (cannot inflate)
    const f = window.fflate; let out = null;
    try { out = f.unzlibSync(c); } catch (e) { out = null; }
    if (!out) { try { f.inflateSync(c.subarray(2)); } catch (e) { return 'bad'; } return 'ok'; }   // headerless: no checksum to verify
    const sum = adler32(out);
    for (let k = 0; k <= 3 && c.length - 4 - k >= 2; k++) {                // tolerate up to 3 trailing EOL/padding bytes
      const o = c.length - 4 - k;
      if ((((c[o] << 24) | (c[o + 1] << 16) | (c[o + 2] << 8) | c[o + 3]) >>> 0) === sum) return 'ok';
    }
    return 'suspect';
  }
  /* Every Flate stream must actually decompress. Broken ones are replaced by a valid empty stream so the file is
     structurally sound everywhere (viewers stop reporting errors); the page that used it is reported as blank/damaged. */
  function sanitize(doc) {
    const L = PL.lib(), f = window.fflate, bad = new Set(); bad.sus = new Set();
    const empty = f.zlibSync(new Uint8Array(0));
    doc.context.enumerateIndirectObjects().forEach(([ref, obj]) => {
      if (!(obj instanceof L.PDFRawStream)) return;
      const ty = obj.dict.get(L.PDFName.of('Type'));
      if (ty && /ObjStm|XRef/.test(ty.asString())) return;
      const flt = obj.dict.get(L.PDFName.of('Filter'));
      const first = flt instanceof L.PDFArray ? flt.get(0) : flt;
      if (!first || !first.asString || first.asString() !== '/FlateDecode') return;
      const c = obj.contents; if (!c || !c.length) return;
      const st = flateOk(c); if (st === 'ok') return;
      if (st === 'suspect') { bad.sus.add(ref.tag); return; }
      obj.dict.set(L.PDFName.of('Length'), L.PDFNumber.of(empty.length));
      doc.context.assign(ref, L.PDFRawStream.of(obj.dict, empty));
      bad.add(ref.tag);
    });
    return bad;
  }
  /* How many objects a page needs (fonts, images, forms, …) are missing or were blanked? Looks 3 levels deep. */
  function missingResources(doc, pg, bad, detail) {
    const L = PL.lib(); let miss = 0;
    const look = o => (o instanceof L.PDFRef) ? doc.context.lookup(o) : o;
    const gone = r => r instanceof L.PDFRef && (!doc.context.lookup(r) || bad.has(r.tag) || (bad.sus && bad.sus.has(r.tag)));
    const seen = new Set();
    function walk(o, depth, soft) {
      if (depth > 3 || !o) return;
      if (o instanceof L.PDFRef) { if (seen.has(o.tag)) return; seen.add(o.tag); if (gone(o)) { if (soft) { missingResources.soft = (missingResources.soft || 0) + 1; return; } miss++; if (detail) detail.push(o.tag + (doc.context.lookup(o) ? ' (blanked)' : ' (absent)')); return; } }
      const d = look(o); if (!d) return;
      const dict = d instanceof L.PDFRawStream ? d.dict : d instanceof L.PDFDict ? d : null;
      if (d instanceof L.PDFArray) { d.asArray().forEach(x => walk(x, depth + 1, soft)); return; }
      if (!dict) return;
      ['FontDescriptor', 'FontFile', 'FontFile2', 'FontFile3', 'DescendantFonts', 'ToUnicode', 'Encoding', 'SMask'].forEach(k => { const v = dict.get(L.PDFName.of(k)); if (v) walk(v, depth + 1, soft || /^FontFile/.test(k)); });
    }
    let res = null;
    try { res = pg.node.Resources(); } catch (e) { res = null; }
    if (!res) return 0;
    ['Font', 'XObject'].forEach(cat => {
      const sub = look(res.get(L.PDFName.of(cat)));
      if (sub instanceof L.PDFDict) sub.entries().forEach(([, v]) => {
        walk(v, 1);
        if (cat !== 'Font') return;
        const fd = look(v); if (!(fd instanceof L.PDFDict)) { miss++; return; }
        const st = fd.get(L.PDFName.of('Subtype')), bf = fd.get(L.PDFName.of('BaseFont'));
        if (!st || !/^\/(Type0|Type1|TrueType|Type3|MMType1)$/.test(st.asString ? st.asString() : '') || (bf && bf.asString && /#(0[0-9A-Fa-f]|1[0-9A-Fa-f]|7[Ff]|[89A-Fa-f][0-9A-Fa-f])/.test(bf.asString()))) { miss++; if (detail) detail.push('font dict ' + (v.tag || '') + ' malformed'); }
      });
    });
    return miss;
  }
  /* Binary junk outside strings in a page's content stream = the stream was damaged (e.g. bytes inserted into an uncompressed stream). */
  function streamJunk(doc, ref) {
    const L = PL.lib(), o = doc.context.lookup(ref);
    if (!(o instanceof L.PDFRawStream) || !o.contents) return 0;
    let u = o.contents;
    const flt = o.dict.get(L.PDFName.of('Filter'));
    if (flt) {
      const first = flt instanceof L.PDFArray ? flt.get(0) : flt;
      if (!first || !first.asString || first.asString() !== '/FlateDecode' || (flt instanceof L.PDFArray && flt.size() > 1)) return 0;
      try { u = window.fflate.unzlibSync(u); } catch (e) { try { u = window.fflate.inflateSync(u.subarray(2)); } catch (e2) { return 0; } }
    }
    if (u.length > 3e6) return 0;
    let junk = 0, i = 0; const n = u.length;
    const text = (b) => b === 9 || b === 10 || b === 12 || b === 13 || b === 0 || (b >= 32 && b < 127);
    while (i < n) {
      const b = u[i];
      if (b === 40) {                                    // ( literal string, balanced, with escapes
        let depth = 1, j = i + 1;
        for (; j < n && depth > 0 && j - i < 20000; j++) { const c = u[j]; if (c === 92) j++; else if (c === 40) depth++; else if (c === 41) depth--; }
        if (depth > 0) { junk += 20; break; }
        i = j; continue;
      }
      if (b === 60 && u[i + 1] === 60) { i += 2; continue; }   // << dictionary
      if (b === 60) {                                    // < hex string >
        let j = i + 1;
        for (; j < n && u[j] !== 62 && j - i < 20000; j++) { const c = u[j]; if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102) || c <= 32)) junk++; }
        i = j + 1; continue;
      }
      if (b === 66 && u[i + 1] === 73 && u[i + 2] <= 32 && (i === 0 || u[i - 1] <= 32)) return 0;   // inline image: binary is legal
      if (!text(b)) junk++;
      i++;
    }
    return junk;
  }
  /* per page: 'ok' | 'damaged' (some content / fonts / images gone) | 'blank' (all page content gone) */
  function contentHealth(doc, bad) {
    const L = PL.lib();
    return doc.getPages().map(pg => {
      const c = pg.node.get(L.PDFName.of('Contents'));
      let n = 0, total = 0, susp = 0;
      if (c) {
        const list = c instanceof L.PDFArray ? c.asArray() : [c];
        total = list.length;
        list.forEach(r => { if (r instanceof L.PDFRef && (!doc.context.lookup(r) || bad.has(r.tag))) n++; });
        if (bad.sus) list.forEach(r => { if (r instanceof L.PDFRef && bad.sus.has(r.tag)) susp++; });
      }
      if (c && n === total) return 'blank';
      if (n > 0 || susp > 0 || missingResources(doc, pg, bad) > 0) return 'damaged';
      if (c) { const list = c instanceof L.PDFArray ? c.asArray() : [c]; let j = 0; list.forEach(r => { if (r instanceof L.PDFRef) j += streamJunk(doc, r); }); if (j > 8) return 'damaged'; }
      return 'ok';
    });
  }
  async function polish(doc, big) {
    const bad = big ? new Set() : sanitize(doc);
    const health = contentHealth(doc, bad);
    return { bytes: await doc.save(), health, blanked: bad.size };
  }
  const count = (h, k) => h.filter(x => x === k).length;

  /* ───────── the operation ───────── */
  R.repair = async function (bytes, o, ctx) {
    ctx = ctx || {}; const prog = ctx.progress || noop;
    if (!bytes || !bytes.length) throw new Error('Empty file (0 bytes)');
    if (bytes.length > (PL.env.mobile ? 120 : 600) * 1048576) throw new Error('File is too large to repair in this browser');
    const big = bytes.length > 150 * 1048576;
    let issues = [];
    const cands = [];                                   // {bytes, recovered, total, strategy, note, issues, images}
    const addCand = (out, pol, v, total, strategy, note, extra) => {
      const blank = count(pol.health, 'blank'), dmg = count(pol.health, 'damaged');
      const iss = (extra || issues).slice();
      if (pol.blanked) iss.push(pol.blanked + ' damaged data stream(s) could not be decompressed and were blanked');
      if (blank) iss.push(blank + ' page(s) are blank — their content was cut off or corrupted and cannot be recovered');
      if (dmg) iss.push(dmg + ' page(s) may show damage (missing fonts/images or corrupted data) — check them');
      const c = { bytes: out, recovered: v.pages - blank - dmg, kept: v.pages - blank, total: Math.max(total || 0, v.pages, (diag && diag.declared) || 0), strategy, note, issues: iss, blank, dmg, images: false };
      cands.push(c); return c;
    };
    const done = c => {
      if (c.issues.length && c.strategy !== 'images' && diag && diag.s && /\/(DCTDecode|JPXDecode)/.test(diag.s)) c.issues.push('Scanned/photo pages can only be checked structurally — look through them for visual glitches');
      if (!c.issues.length) c.issues.push('No structural problems found — wrote a clean copy');
      const kept = c.kept == null ? c.recovered : c.kept;
      const rp = { strategy: c.strategy, issues: c.issues, total: c.total, recovered: kept, damaged: c.dmg || 0, lost: [], images: c.images, blank: c.blank };
      return { bytes: c.bytes, ext: 'pdf', report: rp,
        note: c.note + ' · ' + kept + (c.total !== kept ? '/' + c.total : '') + ' page' + (kept === 1 ? '' : 's') + (c.dmg ? ' (' + c.dmg + ' may show damage)' : '') };
    };
    const perfect = c => c.blank === 0 && c.dmg === 0 && c.recovered > 0;

    // diagnosis (cheap, no parsing)
    let diag = null;
    try { diag = R.scan(bytes); issues = diag.issues.slice(); }
    catch (e) { /* ignore: scan is advisory */ }
    if (diag && diag.encrypted) throw new Error('This PDF is encrypted — remove the password first, then repair');
    if (diag && !diag.recs.length) throw new Error('No PDF objects found — this does not look like a PDF');

    // 1 ── light: pdf-lib reads it as-is
    prog(0.05, 'checking structure');
    try {
      const doc = await loadLib(bytes);
      const pol = await polish(doc, big);
      const v = await verify(pol.bytes, ctx);
      if (v.ok && v.pages === doc.getPageCount() && v.pages > 0) {
        const c = addCand(pol.bytes, pol, v, v.pages, 'light', 'Cleaned up');
        if (perfect(c)) return done(c);
      }
    } catch (e) { if (e && e.name === 'AbortError') throw e; }

    // 2 ── rebuild: scan raw objects, write a clean file
    prog(0.25, 'rebuilding structure');
    let rebuilt = null;
    try { rebuilt = R.rebuild(bytes); } catch (e) { if (/encrypted|No pages|does not look/.test(e.message)) { if (!cands.length) throw e; } else issues.push('Rebuild failed: ' + e.message); }
    let src = null, srcBytes = bytes;
    if (rebuilt) {
      issues = rebuilt.issues.slice();
      srcBytes = rebuilt.bytes;
      try {
        src = await loadLib(rebuilt.bytes);
        const pol = await polish(src, big);
        const v = await verify(pol.bytes, ctx);
        if (v.ok && v.pages > 0) {
          const c = addCand(pol.bytes, pol, v, rebuilt.declared || rebuilt.pages, 'rebuild', rebuilt.synthetic ? 'Rebuilt page tree and cross-reference table' : 'Rebuilt cross-reference table');
          if (perfect(c)) return done(c);
        }
      } catch (e) { if (e && e.name === 'AbortError') throw e; src = null; }
    }

    // 3 ── salvage page by page
    if (!cands.length || !perfect(cands[cands.length - 1])) {
      prog(0.55, 'salvaging pages');
      if (!src) { try { src = await loadLib(bytes); } catch (e) { src = null; } }
      if (src && !cands.length) {
        const { out, lost } = await copyOut(src, ctx);
        if (out.getPageCount()) {
          let pol = await polish(out, big), v = await verify(pol.bytes, ctx);
          if (v.bad.length) { v.bad.slice().sort((a, c) => c - a).forEach(i => out.removePage(i)); pol = out.getPageCount() ? await polish(out, big) : null; v = pol ? await verify(pol.bytes, ctx) : null; }
          if (pol && v && v.pages) {
            const extra = issues.slice(); extra.push((src.getPageCount() - out.getPageCount()) + ' page(s) were too damaged to keep and were dropped');
            addCand(pol.bytes, pol, v, src.getPageCount(), 'salvage', 'Salvaged readable pages', extra);
          }
        }
      }
    }

    // pick the best candidate: most real pages, then fewest damaged
    if (cands.length) {
      cands.sort((a, b) => (b.recovered - a.recovered) || (a.dmg - b.dmg));
      if (cands[0].recovered + cands[0].dmg > 0) return done(cands[0]);
    }

    // 4 ── redraw as images
    if (o && o.images) {
      prog(0.75, 'drawing pages as images');
      let r = await viaImages(srcBytes, ctx, (f, m) => prog(0.75 + f * 0.23, m));
      if (!r && srcBytes !== bytes) r = await viaImages(bytes, ctx, (f, m) => prog(0.75 + f * 0.23, m));
      if (r) {
        const good = r.pages - r.empty;
        if (good > 0 || !cands.length) {
          if (!good) throw new Error('Could not recover any readable pages from this file');
          const iss = issues.slice(); iss.push('Pages were redrawn as images — text is no longer selectable (run Searchable to restore it)');
          if (r.empty) iss.push(r.empty + ' page(s) came out empty — their content was cut off or corrupted and cannot be recovered');
          return done({ bytes: r.bytes, recovered: good, total: Math.max(r.pages + r.lost.length, (diag && diag.declared) || 0), strategy: 'images', note: 'Rebuilt pages as images', issues: iss, blank: r.empty, dmg: 0, images: true });
        }
      }
    }
    throw new Error('Could not recover any pages from this file');
  };

  /* shared-operation form (single tool + Mass Batch) */
  PL.ops = PL.ops || {};
  PL.ops.repair = {
    id: 'repair', label: 'Repair damaged PDF', group: 'Fix', accepts: ['pdf'], anyInput: true, suffix: '-repaired', ext: 'pdf',
    fields: [{ id: 'images', label: 'If pages cannot be read, redraw them as images', type: 'check', value: true }],
    run(bytes, o, ctx) { return R.repair(bytes, o, ctx); }
  };
})(window.PaperLab);
