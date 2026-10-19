/* PaperLab — "Searchable": scanned PDF / image → searchable PDF, 100% in-browser.

   Strategy: keep the original page content untouched and overlay an INVISIBLE text layer
   (text rendering mode 3) positioned word-by-word from Tesseract's bounding boxes.
   → file size ≈ original, looks identical, text is selectable / searchable / copyable.

   Pipeline per PDF page:  pdf.js render (≈200 dpi) → clean-up → Tesseract worker pool
                           → pdf-lib: draw invisible words (rotation-aware) onto the ORIGINAL page. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const OCR = PL.ocr = PL.ocr || {};
  const noop = () => {};

  /* ───────── text-layer fonts (fontkit + Noto, one per script, embedded lazily & subset) ───────── */
  const FONT_FILES = {
    dev: 'NotoSansDevanagari', ben: 'NotoSansBengali', tel: 'NotoSansTelugu', tam: 'NotoSansTamil',
    kan: 'NotoSansKannada', mal: 'NotoSansMalayalam', guj: 'NotoSansGujarati', gur: 'NotoSansGurmukhi',
    ori: 'NotoSansOriya', ara: 'NotoNaskhArabic'
  };
  const fontBytes = {};
  async function loadFontBytes(script) {
    if (!fontBytes[script]) {
      const url = 'vendor/fonts/' + FONT_FILES[script] + '-Regular.woff?v=20261019c';
      fontBytes[script] = fetch(url).then(r => {
        if (!r.ok) throw new Error('Font file missing: ' + url);
        return r.arrayBuffer();
      }).then(b => new Uint8Array(b));
      fontBytes[script].catch(() => { delete fontBytes[script]; });
    }
    return fontBytes[script];
  }

  /* Unicode block → script key ('latin' = everything else, incl. digits & punctuation) */
  function scriptOfCode(c) {
    if (c < 0x0600) return 'latin';
    if (c <= 0x06FF || (c >= 0x0750 && c <= 0x077F) || (c >= 0xFB50 && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF)) return 'ara';
    if (c >= 0x0900 && c <= 0x097F) return 'dev';
    if (c >= 0x0980 && c <= 0x09FF) return 'ben';
    if (c >= 0x0A00 && c <= 0x0A7F) return 'gur';
    if (c >= 0x0A80 && c <= 0x0AFF) return 'guj';
    if (c >= 0x0B00 && c <= 0x0B7F) return 'ori';
    if (c >= 0x0B80 && c <= 0x0BFF) return 'tam';
    if (c >= 0x0C00 && c <= 0x0C7F) return 'tel';
    if (c >= 0x0C80 && c <= 0x0CFF) return 'kan';
    if (c >= 0x0D00 && c <= 0x0D7F) return 'mal';
    return 'latin';
  }
  OCR._scriptOfCode = scriptOfCode;
  OCR._loadFontBytes = loadFontBytes;

  /* The text layer is INVISIBLE, so glyph shapes never matter — only that copy / search get the right Unicode.
     fontkit's shaper would hurt: it reorders Indic vowel signs (विशाल → िवशाल in extracted text), and its GPOS code
     crashes on some Noto subsets (Telugu). So we bypass layout entirely: every character maps to its own glyph, in
     logical order, and the ToUnicode map is therefore exact. pdf-lib's embedder is patched per font instance. */
  function plainEncoding(font, script) {
    const emb = font && font.embedder;
    if (!emb || !emb.font || !emb.subset || !emb.glyphIdMap) throw new Error('Unexpected pdf-lib font internals — cannot build the text layer');
    const L = PL.lib();
    emb.encodeText = function (text) {
      const hex = [];
      for (const ch of text) {
        const g = this.font.glyphForCodePoint(ch.codePointAt(0));
        const sid = this.subset.includeGlyph(g);
        this.glyphs[sid - 1] = g; this.glyphIdMap.set(g.id, sid);
        hex.push(sid.toString(16).padStart(4, '0'));
      }
      this.glyphCache.invalidate();
      return L.PDFHexString.of(hex.join(''));
    };
    emb.widthOfTextAtSize = function (text, size) {
      let w = 0;
      for (const ch of text) w += this.font.glyphForCodePoint(ch.codePointAt(0)).advanceWidth * this.scale;
      return w * (size / 1000);
    };
    font._plain = script;
  }
  OCR._plainEncoding = plainEncoding;

  /* One FontSet per output document; fonts embed lazily, only when a word needs them. */
  class FontSet {
    constructor(doc) { this.doc = doc; this.f = {}; this.sets = {}; this.kit = false; }
    async get(script) {
      if (this.f[script]) return this.f[script];
      const { StandardFonts } = PL.lib();
      let font;
      if (script === 'latin') {
        font = await this.doc.embedFont(StandardFonts.Helvetica);
        this.sets.latin = new Set(font.getCharacterSet());
      } else {
        if (!this.kit) {
          if (!window.fontkit) {
            await PL.loadScript('vendor/regenerator-runtime.js');
            await PL.loadScript('vendor/fontkit.umd.min.js');
          }
          this.doc.registerFontkit(window.fontkit); this.kit = true;
        }
        font = await this.doc.embedFont(await loadFontBytes(script), { subset: true });
        plainEncoding(font, script);
        this.sets[script] = new Set(font.getCharacterSet());
      }
      return (this.f[script] = font);
    }
    /* → [{font,text}] runs, one per script, characters a font cannot encode removed. null if nothing is left. */
    async prepare(raw) {
      const runs = [];
      for (const ch of raw.normalize('NFC')) {
        const cp = ch.codePointAt(0);
        let sc = scriptOfCode(cp);
        const last = runs[runs.length - 1];
        if (cp === 0x200C || cp === 0x200D) { if (last && last.script !== 'latin') last.text += ch; continue; }  // ZWNJ/ZWJ keep conjuncts
        if (last && last.script === sc) last.text += ch; else runs.push({ script: sc, text: ch });
      }
      const out = [];
      for (const r of runs) {
        const font = await this.get(r.script);
        const t = r.script === 'latin' ? r.text.normalize('NFKC') : r.text;
        const ok = this.sets[r.script];
        let clean = Array.from(t).filter(c => ok.has(c.codePointAt(0))).join('');
        // RTL scripts: PDF stores visual order and extractors (pdf.js, Acrobat, PDFium) re-run bidi, so store it reversed
        if (r.script === 'ara') clean = Array.from(clean).reverse().join('');
        if (clean.trim()) out.push({ font, text: clean });
      }
      return out.length ? out : null;
    }
  }

  /* ───────── invisible text layer ───────── */
  function drawLayer(page, fonts, ocr, mapper, o) {
    const L = PL.lib();
    const keys = new Map();
    const keyFor = font => {
      if (!keys.has(font)) keys.set(font, page.node.newFontDictionary(font.name, font.ref));
      return keys.get(font);
    };
    const ops = [];
    let words = 0;
    const jobs = [];
    ocr.lines.forEach(line => {
      const ws = line.words.filter(w => (w.confidence == null || w.confidence >= (o.minConf == null ? 10 : o.minConf)));
      ws.forEach((w, wi) => jobs.push({ w, last: wi === ws.length - 1 }));
    });
    return (async () => {
      for (const { w, last } of jobs) {
        const segs = await fonts.prepare(w.text);
        if (!segs) continue;
        const bb = w.bbox, h = Math.max(1, bb.y1 - bb.y0);
        let p0, p1;
        const bl = w.baseline;
        if (bl && bl.has_baseline && (bl.x1 - bl.x0) > 0) { p0 = [bl.x0, bl.y0]; p1 = [bl.x1, bl.y1]; }
        else { const yb = bb.y1 - h * 0.2; p0 = [bb.x0, yb]; p1 = [bb.x1, yb]; }
        const P0 = mapper.toPdf(p0[0], p0[1]), P1 = mapper.toPdf(p1[0], p1[1]);
        const dx = P1[0] - P0[0], dy = P1[1] - P0[1];
        const wPt = Math.hypot(dx, dy);
        if (!(wPt > 0)) continue;
        const ang = Math.atan2(dy, dx), cos = Math.cos(ang), sin = Math.sin(ang);
        const size = Math.max(1, h * 0.95 * mapper.scale);
        const natural = segs.reduce((n, sg) => n + sg.font.widthOfTextAtSize(sg.text, size), 0);
        if (!(natural > 0)) continue;
        const tz = Math.min(400, Math.max(10, 100 * wPt / natural));
        if (!last) segs.push({ font: await fonts.get('latin'), text: ' ' });   // word separator for copy / search
        ops.push(L.pushGraphicsState(), L.beginText(),
          o.debugVisible ? L.setFillingRgbColor(1, 0, 0) : L.setTextRenderingMode(L.TextRenderingMode.Invisible),
          L.setCharacterSqueeze(tz),
          L.setTextMatrix(cos, sin, -sin, cos, P0[0], P0[1]));
        segs.forEach(sg => ops.push(L.setFontAndSize(keyFor(sg.font), size), L.showText(sg.font.encodeText(sg.text))));
        ops.push(L.endText(), L.popGraphicsState());
        words++;
      }
      for (let i = 0; i < ops.length; i += 4000) page.pushOperators(...ops.slice(i, i + 4000));   // chunked: huge spreads overflow the stack
      return words;
    })();
  }

  /* ───────── image clean-up (grayscale + percentile contrast stretch) ───────── */
  function enhance(cv) {
    const g = cv.getContext('2d');
    const img = g.getImageData(0, 0, cv.width, cv.height), d = img.data, hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      d[i] = d[i + 1] = d[i + 2] = l; hist[l]++;
    }
    const total = d.length / 4; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break; } }
    if (hi - lo < 40) { lo = Math.max(0, lo - 20); hi = Math.min(255, hi + 20); }
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, (v - lo) * 255 / (hi - lo)));
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lut[d[i]];
    g.putImageData(img, 0, 0);
  }

  async function ocrCanvas(cv, o, ctx) {
    if (o.enhance !== false && o.enhance !== 'false') enhance(cv);
    const blob = await PL.canvasToBlob(cv, 'image/png');
    return OCR.recognize(blob, ctx);
  }

  const maxSide = () => PL.env.mobile ? 3000 : 5000;
  const wordCount = r => r.lines.reduce((n, l) => n + l.words.length, 0);
  const pageText = r => r.lines.map(l => l.words.map(w => w.text).join(' ')).join('\n');

  async function bootEngine(o, ctx) {
    const prog = (ctx && ctx.progress) || noop;
    await OCR.acquire(OCR.langId(o), +o.workers || OCR.defaultWorkers(), m => prog(0, m));
  }

  /* ───────── PDF input ───────── */
  OCR.fromPdf = async function (bytes, o, ctx) {
    ctx = ctx || {}; o = o || {};
    const prog = ctx.progress || noop;
    const { PDFDocument } = PL.lib();
    const doc = await PDFDocument.load(bytes);            // strict: encrypted files fail loudly
    const pdf = await PL.openPdfjs(bytes);
    const pages = doc.getPages(), total = pdf.numPages;
    if (pages.length !== total) throw new Error('Page count mismatch between engines');
    try {
      await bootEngine(o, ctx);
      const fonts = new FontSet(doc);
      const dpi = +o.dpi || 200, scale = dpi / 72;
      const texts = new Array(total).fill('');
      let done = 0, ocrd = 0, skipped = 0, words = 0;
      const pending = new Set();
      const win = (+o.workers || OCR.defaultWorkers()) + 1;
      let firstErr = null;

      for (let i = 1; i <= total; i++) {
        PL.abortIf(ctx);
        if (firstErr) break;
        const page = await pdf.getPage(i);
        if (o.skipText !== false && o.skipText !== 'false') {
          const tc = await page.getTextContent();
          const chars = tc.items.reduce((n, it) => n + it.str.replace(/\s/g, '').length, 0);
          if (chars >= 25) {
            skipped++; done++; page.cleanup();
            texts[i - 1] = tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('').trim();
            prog(done / total, 'page ' + done + '/' + total);
            continue;
          }
        }
        const { cv, vp } = await PL.renderPage(page, Math.min(scale, maxSide() / Math.max(page.view[2] - page.view[0], page.view[3] - page.view[1])), Math.min(PL.env.maxCanvasPx, 22e6));
        page.cleanup();
        const mapper = { toPdf: (x, y) => vp.convertToPdfPoint(x, y), scale: 1 / vp.scale };
        const idx = i - 1, pdfPage = pages[idx];
        const job = (async () => {
          const res = await ocrCanvas(cv, o, ctx);
          PL.freeCanvas(cv);
          words += await drawLayer(pdfPage, fonts, res, mapper, o);
          texts[idx] = pageText(res); ocrd++;
        })().catch(e => { PL.freeCanvas(cv); firstErr = firstErr || e; })
          .finally(() => { pending.delete(job); done++; prog(done / total, 'page ' + done + '/' + total); });
        pending.add(job);
        if (pending.size >= win) await Promise.race(pending);
        await PL.tick();
      }
      await Promise.all(pending);
      if (firstErr) throw firstErr;
      PL.abortIf(ctx);

      const text = texts.map((t, i) => '— Page ' + (i + 1) + ' —\n' + t).join('\n\n');
      const extras = o.wantText ? [{ bytes: new TextEncoder().encode(text), ext: 'txt', suffix: '' }] : [];
      if (!ocrd) return { bytes, extras, text, pages: total, ocrPages: 0, skippedPages: skipped, words: 0, skipped: true, note: 'already searchable — copied unchanged' };
      const out = await doc.save();
      return {
        bytes: out, extras, text, pages: total, ocrPages: ocrd, skippedPages: skipped, words,
        note: ocrd + '/' + total + ' pages OCR’d' + (skipped ? ', ' + skipped + ' already had text' : '') + ' · ' + words + ' words'
      };
    } finally { pdf.destroy(); }
  };

  /* ───────── image input (one or many images → one searchable PDF) ───────── */
  const A4 = [595.28, 841.89];
  OCR.fromImages = async function (list, o, ctx) {
    ctx = ctx || {}; o = o || {};
    const prog = ctx.progress || noop;
    const { PDFDocument } = PL.lib();
    const doc = await PDFDocument.create();
    await bootEngine(o, ctx);
    const fonts = new FontSet(doc);
    const texts = []; let words = 0;
    const MAXS = maxSide();
    for (let i = 0; i < list.length; i++) {
      PL.abortIf(ctx);
      prog(i / list.length, 'image ' + (i + 1) + '/' + list.length);
      let bmp;
      try { bmp = await createImageBitmap(new Blob([list[i].bytes])); }
      catch (e) { throw new Error((list[i].name || 'image') + ': unsupported or damaged image'); }
      const k = Math.min(1, MAXS / Math.max(bmp.width, bmp.height));
      const cw = Math.max(1, Math.round(bmp.width * k)), ch = Math.max(1, Math.round(bmp.height * k));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); g.drawImage(bmp, 0, 0, cw, ch);
      bmp.close && bmp.close();
      const jpg = new Uint8Array(await (await PL.canvasToBlob(cv, 'image/jpeg', 0.9)).arrayBuffer());
      const [bw, bh] = cw <= ch ? A4 : [A4[1], A4[0]];
      const s = Math.min(bw / cw, bh / ch);
      const pw = cw * s, ph = ch * s;
      const img = await doc.embedJpg(jpg);
      const page = doc.addPage([pw, ph]);
      page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
      const res = await ocrCanvas(cv, o, ctx);       // (enhances in place — colour copy is already embedded)
      PL.freeCanvas(cv);
      words += await drawLayer(page, fonts, res, { toPdf: (x, y) => [x * s, ph - y * s], scale: s }, o);
      texts.push(pageText(res));
      prog((i + 1) / list.length, 'image ' + (i + 1) + '/' + list.length);
      await PL.tick();
    }
    const text = texts.map((t, i) => '— Page ' + (i + 1) + ' —\n' + t).join('\n\n');
    const bytes = await doc.save();
    return {
      bytes, text, pages: list.length, ocrPages: list.length, skippedPages: 0, words,
      extras: o.wantText ? [{ bytes: new TextEncoder().encode(text), ext: 'txt', suffix: '' }] : [],
      note: list.length + ' image' + (list.length > 1 ? 's' : '') + ' · ' + words + ' words'
    };
  };

  /* ───────── op registration (Mass Batch + single tool share this) ───────── */
  PL.ops.searchable = {
    id: 'searchable', label: 'Searchable (OCR → searchable PDF)', group: 'Optimize',
    accepts: ['pdf', 'image'], suffix: '-searchable', ext: 'pdf', heavy: true,
    fields: [
      { id: 'lang', label: 'Language', type: 'select', value: 'eng', options: OCR.LANGS.map(l => [l.id, l.label]) },
      { id: 'eng', label: 'Also recognise English', type: 'check', value: true },
      { id: 'dpi', label: 'Quality', type: 'select', value: '200', options: [['150', 'Fast (150 dpi)'], ['200', 'Balanced (200 dpi)'], ['300', 'Best (300 dpi, slower)']] },
      { id: 'skipText', label: 'Skip pages that already have text', type: 'check', value: true },
      { id: 'enhance', label: 'Clean up scans (grayscale + contrast)', type: 'check', value: true },
      { id: 'wantText', label: 'Also save a .txt next to each PDF', type: 'check', value: false }
    ],
    async run(bytes, o, ctx) {
      const kind = PL.sniff(bytes);
      if (kind === 'pdf') return OCR.fromPdf(bytes, o, ctx);
      if (kind) return OCR.fromImages([{ bytes, name: ctx && ctx.name }], o, ctx);
      throw new Error('Not a PDF or supported image (JPG / PNG / WebP)');
    }
  };
})(window.PaperLab);
