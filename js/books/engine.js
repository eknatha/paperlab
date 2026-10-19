/* PaperLab — e-books & comics: CBZ ⇄ PDF and EPUB ⇄ PDF, 100% in the browser.

     cbz2pdf   comic archive → PDF         (JPEGs are embedded untouched; other formats are converted)
     pdf2cbz   PDF → comic archive         (pages rendered to JPEG/PNG + ComicInfo.xml)
     epub2pdf  EPUB → PDF                  (own typesetter: selectable text, headings, lists, images, bookmarks;
                                            Latin via Noto Serif, Indian scripts via the bundled Noto fonts)
     pdf2epub  PDF → EPUB 3                (reflowable text, or fixed-layout page images; cover + navigation)

   Not supported on purpose: DRM-protected e-books (PaperLab never removes DRM), CBR/RAR archives. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const K = PL.books = {};
  const ops = PL.ops = PL.ops || {};
  const noop = () => {};
  const te = new TextEncoder(), td = new TextDecoder('utf-8');
  const F = () => window.fflate;

  /* ───────────────────────── shared helpers ───────────────────────── */
  const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };
  const extOf = n => (/\.([A-Za-z0-9]+)$/.exec(n) || [])[1] ? (/\.([A-Za-z0-9]+)$/.exec(n)[1]).toLowerCase() : '';
  const xesc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function isJpeg(u) { return u[0] === 0xFF && u[1] === 0xD8; }
  function isPng(u) { return u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4E && u[3] === 0x47; }

  /* decode any browser-supported image → canvas (optionally scaled so the long side ≤ maxPx) */
  async function decodeToCanvas(bytes, mime, maxPx) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    try {
      let w = bmp.width, h = bmp.height;
      const lim = PL.env.maxCanvasPx;
      let s = 1;
      if (maxPx && Math.max(w, h) > maxPx) s = maxPx / Math.max(w, h);
      if (w * h * s * s > lim) s = Math.sqrt(lim / (w * h));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      return { cv, w, h };
    } finally { if (bmp.close) bmp.close(); }
  }
  async function canvasBytes(cv, type, q) { const b = await PL.canvasToBlob(cv, type, q); return new Uint8Array(await b.arrayBuffer()); }

  /* → { image: PDFImage, w, h } using the cheapest correct path */
  async function embedAny(doc, bytes, name, maxPx) {
    const ext = extOf(name);
    let w = 0, h = 0;
    if (!maxPx && isJpeg(bytes)) { const im = await doc.embedJpg(bytes); return { image: im, w: im.width, h: im.height }; }
    if (!maxPx && isPng(bytes)) { const im = await doc.embedPng(bytes); return { image: im, w: im.width, h: im.height }; }
    const mime = MIME[ext] || (isJpeg(bytes) ? 'image/jpeg' : isPng(bytes) ? 'image/png' : 'image/webp');
    const d = await decodeToCanvas(bytes, mime, maxPx);
    try {
      const useJpeg = ext !== 'gif' && ext !== 'png';
      const out = await canvasBytes(d.cv, useJpeg ? 'image/jpeg' : 'image/png', 0.86);
      const im = useJpeg ? await doc.embedJpg(out) : await doc.embedPng(out);
      return { image: im, w: im.width, h: im.height };
    } finally { PL.freeCanvas(d.cv); }
  }

  function unzipFiltered(u8, pred) {
    try { return F().unzipSync(u8, { filter: f => pred(f.name, f) }); }
    catch (e) { throw new Error('This file is not a valid ZIP archive (damaged or wrong type)'); }
  }
  function listZip(u8) {
    const names = [];
    unzipFiltered(u8, (n, f) => { names.push({ name: n, size: f.originalSize }); return false; });
    return names;
  }

  /* ───────────────────────── CBZ → PDF ───────────────────────── */
  ops.cbz2pdf = {
    id: 'cbz2pdf', label: 'Comic (CBZ) → PDF', group: 'Books & comics', accepts: ['cbz'], suffix: '', ext: 'pdf',
    fields: [
      { id: 'page', label: 'Page size', type: 'select', value: 'fit', options: [['fit', 'Match each image'], ['a4', 'A4'], ['letter', 'Letter']] },
      { id: 'max', label: 'Image size', type: 'select', value: '0', options: [['0', 'Keep original (fastest, no quality loss)'], ['2400', 'Shrink large images (≤ 2400 px)'], ['1600', 'Smaller file (≤ 1600 px)']] }
    ],
    async run(bytes, o, ctx) {
      ctx = ctx || {}; const prog = ctx.progress || noop;
      const { PDFDocument } = PL.lib();
      const all = listZip(bytes)
        .filter(e => IMG_RE.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name) && !/\/$/.test(e.name))
        .sort((a, b) => PL.natCompare(a.name, b.name));
      if (!all.length) throw new Error('No images found inside this archive (is it a CBZ / comic ZIP?)');
      const doc = await PDFDocument.create();
      const SZ = { a4: [595.28, 841.89], letter: [612, 792] };
      const maxPx = +o.max || 0; let skipped = 0;
      for (let i = 0; i < all.length; i++) {
        PL.abortIf(ctx); prog(i / all.length, 'page ' + (i + 1) + '/' + all.length);
        const nm = all[i].name;
        const data = unzipFiltered(bytes, n => n === nm)[nm];
        try {
          const r = await embedAny(doc, data, nm, maxPx);
          let pw, ph, iw, ih, x = 0, y = 0;
          if (!o.page || o.page === 'fit') { pw = r.w * 72 / 150; ph = r.h * 72 / 150; iw = pw; ih = ph; }
          else {
            [pw, ph] = SZ[o.page] || SZ.a4;
            if (r.w > r.h) [pw, ph] = [ph, pw];                     // landscape spread → landscape page
            const sc = Math.min(pw / r.w, ph / r.h); iw = r.w * sc; ih = r.h * sc; x = (pw - iw) / 2; y = (ph - ih) / 2;
          }
          doc.addPage([pw, ph]).drawImage(r.image, { x, y, width: iw, height: ih });
        } catch (e) { if (e && e.name === 'AbortError') throw e; skipped++; }
        if (i % 5 === 4) await PL.tick();
      }
      if (!doc.getPageCount()) throw new Error('None of the images could be read');
      // title from ComicInfo.xml if present
      try {
        const ci = unzipFiltered(bytes, n => /(^|\/)ComicInfo\.xml$/i.test(n));
        const k = Object.keys(ci)[0];
        if (k) { const t = /<Title>([^<]*)<\/Title>/i.exec(td.decode(ci[k])); const s = /<Series>([^<]*)<\/Series>/i.exec(td.decode(ci[k])); if (t || s) doc.setTitle(((s ? s[1] + ' ' : '') + (t ? t[1] : '')).trim()); }
      } catch (e) { /* optional */ }
      return { bytes: await doc.save(), note: doc.getPageCount() + ' pages' + (skipped ? ' · ' + skipped + ' unreadable image(s) skipped' : '') };
    }
  };

  /* ───────────────────────── PDF → CBZ ───────────────────────── */
  ops.pdf2cbz = {
    id: 'pdf2cbz', label: 'PDF → Comic (CBZ)', group: 'Books & comics', accepts: ['pdf'], suffix: '', ext: 'cbz',
    fields: [
      { id: 'dpi', label: 'Resolution', type: 'select', value: '1.5', options: [['1.1', 'Low (≈ 80 dpi)'], ['1.5', 'Standard (≈ 110 dpi)'], ['2.1', 'High (≈ 150 dpi)'], ['2.8', 'Very high (≈ 200 dpi)']] },
      { id: 'fmt', label: 'Image format', type: 'select', value: 'jpg', options: [['jpg', 'JPEG (smaller)'], ['png', 'PNG (lossless)']] }
    ],
    async run(bytes, o, ctx) {
      ctx = ctx || {}; const prog = ctx.progress || noop;
      const pdf = await PL.openPdfjs(bytes);
      try {
        const n = pdf.numPages, files = {}, pad = String(n).length < 3 ? 3 : String(n).length;
        const png = o.fmt === 'png';
        for (let i = 1; i <= n; i++) {
          PL.abortIf(ctx); prog((i - 1) / n, 'page ' + i + '/' + n);
          const page = await pdf.getPage(i);
          const { cv } = await PL.renderPage(page, +o.dpi || 1.5);
          const data = await canvasBytes(cv, png ? 'image/png' : 'image/jpeg', 0.86);
          PL.freeCanvas(cv); page.cleanup();
          files[String(i).padStart(pad, '0') + (png ? '.png' : '.jpg')] = [data, { level: 0 }];
          await PL.tick();
        }
        let title = ''; try { const md = await pdf.getMetadata(); title = (md.info && md.info.Title) || ''; } catch (e) { /* none */ }
        title = title || (ctx.name || 'Comic').replace(/\.pdf$/i, '');
        files['ComicInfo.xml'] = [te.encode('<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <Title>' + xesc(title) + '</Title>\n  <PageCount>' + n + '</PageCount>\n</ComicInfo>\n'), { level: 6 }];
        return { bytes: F().zipSync(files), note: n + ' pages' };
      } finally { pdf.destroy(); }
    }
  };

  /* ───────────────────────── EPUB reading ───────────────────────── */
  function dirOf(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); }
  function resolvePath(base, href) {
    href = href.split('#')[0].split('?')[0];
    let r = href.startsWith('/') ? href.slice(1) : dirOf(base) + href;
    const out = [];
    r.split('/').forEach(seg => { if (seg === '..') out.pop(); else if (seg !== '.' && seg !== '') out.push(seg); });
    return out.join('/');
  }
  const decodeHref = h => { try { return decodeURIComponent(h); } catch (e) { return h; } };

  function parseXml(text, type) {
    const d = new DOMParser().parseFromString(text, type || 'application/xml');
    return d.getElementsByTagName('parsererror').length ? null : d;
  }
  const q = (root, name) => Array.prototype.slice.call(root.getElementsByTagNameNS('*', name));

  K.readEpub = function (bytes) {
    let files;
    try { files = F().unzipSync(bytes, { filter: f => !/\.(otf|ttf|woff2?|mp3|mp4|m4a|ogg|wav|webm|mov)$/i.test(f.name) }); }
    catch (e) { throw new Error('This file is not a valid EPUB (not a ZIP archive)'); }
    const get = n => files[n] || files[decodeHref(n)] || files[Object.keys(files).find(k => k.toLowerCase() === n.toLowerCase())];
    const text = n => { const b = get(n); return b ? td.decode(b) : null; };
    // DRM: anything other than font obfuscation means the content is encrypted
    const enc = text('META-INF/encryption.xml');
    if (enc) {
      const algs = (enc.match(/Algorithm="([^"]+)"/g) || []).map(a => a.slice(11, -1));
      if (algs.some(a => !/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(a)) || /EncryptedData[^>]*>[\s\S]*?<\/?[^>]*(content|\.x?html?)/i.test(enc) && algs.some(a => !/embedding/.test(a))) {
        throw new Error('This EPUB is DRM-protected. PaperLab does not remove DRM — use a copy you are licensed to convert.');
      }
    }
    const cont = text('META-INF/container.xml');
    if (!cont) throw new Error('Not a valid EPUB (META-INF/container.xml missing)');
    const cdoc = parseXml(cont); const rf = cdoc && q(cdoc, 'rootfile')[0];
    const opfPath = rf && rf.getAttribute('full-path');
    if (!opfPath || !get(opfPath)) throw new Error('Not a valid EPUB (package file missing)');
    const odoc = parseXml(text(opfPath));
    if (!odoc) throw new Error('The EPUB package file is damaged');
    const manifest = {};
    q(odoc, 'item').forEach(it => { manifest[it.getAttribute('id')] = { href: resolvePath(opfPath, decodeHref(it.getAttribute('href') || '')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' }; });
    const spine = q(odoc, 'itemref').map(r => manifest[r.getAttribute('idref')]).filter(m => m && /x?html/i.test(m.type) && get(m.href));
    if (!spine.length) throw new Error('This EPUB has no readable chapters');
    const meta = n => { const e = q(odoc, n)[0]; return e ? e.textContent.trim() : ''; };
    let cover = null;
    const ci = Object.values(manifest).find(m => /cover-image/.test(m.props));
    if (ci) cover = ci.href;
    else { const cm = q(odoc, 'meta').find(m => m.getAttribute('name') === 'cover'); if (cm && manifest[cm.getAttribute('content')]) cover = manifest[cm.getAttribute('content')].href; }
    // table of contents titles (nav or ncx), keyed by file path
    const titles = {};
    try {
      const nav = Object.values(manifest).find(m => /\bnav\b/.test(m.props)), ncx = Object.values(manifest).find(m => /ncx/.test(m.type));
      if (nav && get(nav.href)) {
        const nd = parseXml(text(nav.href), 'application/xhtml+xml') || new DOMParser().parseFromString(text(nav.href), 'text/html');
        q(nd, 'a').forEach(a => { const h = a.getAttribute('href'); if (h) { const p = resolvePath(nav.href, decodeHref(h)); if (!titles[p]) titles[p] = a.textContent.replace(/\s+/g, ' ').trim(); } });
      } else if (ncx && get(ncx.href)) {
        const nd = parseXml(text(ncx.href));
        q(nd, 'navPoint').forEach(np => { const c = q(np, 'content')[0], l = q(np, 'text')[0]; if (c && l) { const p = resolvePath(ncx.href, decodeHref(c.getAttribute('src') || '')); if (!titles[p]) titles[p] = l.textContent.trim(); } });
      }
    } catch (e) { /* titles are optional */ }
    return { files, get, text, spine, cover, titles, title: meta('title'), author: meta('creator'), lang: meta('language') };
  };

  /* ───────────────────────── EPUB → PDF (typesetter) ───────────────────────── */
  const BLOCK = new Set('p div section article aside header footer main nav figure figcaption blockquote ul ol li dl dt dd pre table thead tbody tfoot tr td th h1 h2 h3 h4 h5 h6 hr address details summary body html center form fieldset'.split(' '));
  const SKIPT = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'rt', 'rp', 'audio', 'video', 'canvas', 'object', 'iframe']);

  /* XHTML/HTML document → flat list of blocks: h, p (with optional bullet), pre, img, hr */
  function extractBlocks(doc) {
    const blocks = []; let runs = []; let align = ''; const lists = []; let quote = 0;
    const flush = (kind, extra) => {
      const out = [];
      runs.forEach(r => {
        const t = r.text.replace(/[ \t\r\n\f]+/g, ' ');
        if (!t) return;
        const last = out[out.length - 1];
        if (last && last.b === r.b && last.i === r.i) last.text += t; else out.push({ text: t, b: r.b, i: r.i });
      });
      runs = [];
      if (out.length) { out[0].text = out[0].text.replace(/^ +/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, ''); }
      const clean = out.filter(r => r.text && r.text.replace(/\u2028/g, '').trim() !== '' || r.text === '\u2028');
      if (!clean.some(r => r.text.replace(/\u2028/g, '').trim())) return;
      blocks.push(Object.assign({ t: kind || 'p', runs: clean, align, quote, depth: Math.max(0, lists.length - 1) }, extra || {}));
    };
    const attr = (el, n) => (el.getAttribute && el.getAttribute(n)) || '';
    const alignOf = el => { const st = attr(el, 'style'), a = attr(el, 'align'); return /text-align\s*:\s*center/i.test(st) || a === 'center' || /^center$/i.test(el.localName) ? 'center' : /text-align\s*:\s*right/i.test(st) || a === 'right' ? 'right' : null; };
    function walk(node, st) {
      if (node.nodeType === 3) { runs.push({ text: node.nodeValue, b: st.b, i: st.i }); return; }
      if (node.nodeType !== 1) return;
      const tag = (node.localName || '').toLowerCase();
      if (SKIPT.has(tag)) return;
      const style = attr(node, 'style');
      const ns = { b: st.b || /^(b|strong|th)$/.test(tag) || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style),
                   i: st.i || /^(i|em|cite|dfn|var)$/.test(tag) || /font-style\s*:\s*italic/i.test(style) };
      const kids = (n, s) => Array.prototype.forEach.call(n.childNodes, c => walk(c, s));
      if (tag === 'br') { runs.push({ text: '\u2028', b: st.b, i: st.i }); return; }
      if (tag === 'img' || tag === 'image') {
        flush(); const href = attr(node, 'src') || attr(node, 'href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (href) blocks.push({ t: 'img', href, alt: attr(node, 'alt') }); return;
      }
      if (tag === 'svg') {
        flush();
        Array.prototype.slice.call(node.getElementsByTagNameNS('*', 'image')).forEach(im => { const href = attr(im, 'href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href'); if (href) blocks.push({ t: 'img', href, alt: '' }); });
        return;
      }
      if (tag === 'hr') { flush(); blocks.push({ t: 'hr' }); return; }
      if (tag === 'pre') { flush(); const s = node.textContent.replace(/\r/g, '').replace(/\n+$/, ''); if (s.trim()) blocks.push({ t: 'pre', text: s }); return; }
      if (tag === 'table') {
        flush();
        Array.prototype.slice.call(node.getElementsByTagNameNS('*', 'tr')).forEach(tr => {
          const cells = Array.prototype.slice.call(tr.childNodes).filter(c => c.nodeType === 1 && /^(td|th)$/i.test(c.localName));
          const txt = cells.map(c => c.textContent.replace(/\s+/g, ' ').trim());
          if (txt.some(Boolean)) { runs.push({ text: txt.join('   |   '), b: cells.some(c => /^th$/i.test(c.localName)), i: false }); flush(); }
        });
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        flush(); const pa = align; align = alignOf(node) || align;
        kids(node, { b: true, i: ns.i });
        flush('h', { level: +tag[1] }); align = pa; return;
      }
      if (tag === 'ul' || tag === 'ol') {
        flush(); lists.push({ n: 0, ordered: tag === 'ol' }); kids(node, st); flush(); lists.pop(); return;
      }
      if (tag === 'li') {
        flush(); const L = lists[lists.length - 1]; if (L) L.n++;
        const marker = L && L.ordered ? L.n + '.' : '•', start = blocks.length;
        const pa = align; align = alignOf(node) || align;
        kids(node, st); flush();
        for (let k = start; k < blocks.length; k++) if (blocks[k].t === 'p') { blocks[k].bullet = marker; break; }
        align = pa; return;
      }
      if (tag === 'blockquote') { flush(); quote++; kids(node, st); flush(); quote--; return; }
      if (BLOCK.has(tag)) {
        flush(); const pa = align; align = alignOf(node) || align;
        kids(node, st); flush(); align = pa; return;
      }
      kids(node, ns);
    }
    const body = doc.getElementsByTagNameNS('*', 'body')[0] || doc.documentElement;
    Array.prototype.forEach.call(body.childNodes, c => walk(c, { b: false, i: false }));
    flush();
    return { blocks };
  }

  /* fonts for the typesetter */
  const SCRIPT_FONT = { dev: 1, ben: 1, tel: 1, tam: 1, kan: 1, mal: 1, guj: 1, gur: 1, ori: 1, ara: 1 };
  class Faces {
    constructor(doc) { this.doc = doc; this.cache = {}; this.kit = false; this.rtl = false; }
    async ensureKit() {
      if (this.kit) return;
      if (!window.fontkit) { await PL.loadScript('vendor/regenerator-runtime.js'); await PL.loadScript('vendor/fontkit.umd.min.js'); }
      this.doc.registerFontkit(window.fontkit); this.kit = true;
    }
    async get(key, loader) {
      if (this.cache[key]) return this.cache[key];
      await this.ensureKit();
      const bytes = await loader();
      const font = await this.doc.embedFont(bytes, { subset: true });
      const face = { font, key, set: new Set(font.getCharacterSet()), wcache: new Map(), plain: false };
      return (this.cache[key] = face);
    }
    latin(style) {
      const name = { r: 'Regular', b: 'Bold', i: 'Italic', bi: 'BoldItalic' }[style] || 'Regular';
      return this.get('serif-' + name, () => fetch('vendor/fonts/NotoSerif-' + name + '.woff?v=20261019b').then(r => { if (!r.ok) throw new Error('Font file missing: NotoSerif-' + name); return r.arrayBuffer(); }).then(b => new Uint8Array(b)));
    }
    script(sc) { return this.get('script-' + sc, () => PL.ocr._loadFontBytes(sc)); }
    /* fontkit's shaper is right for drawing but can crash on some Noto subsets: fall back to 1:1 glyph mapping */
    forcePlain(face) { if (!face.plain && face.key.startsWith('script-')) { PL.ocr._plainEncoding(face.font, face.key.slice(7)); face.plain = true; face.wcache.clear(); } }
    width(face, text, size) {
      const k = text; let w = face.wcache.get(k);
      if (w == null) {
        try { w = face.font.widthOfTextAtSize(text, 1000); }
        catch (e) { this.forcePlain(face); w = face.font.widthOfTextAtSize(text, 1000); }
        face.wcache.set(k, w);
      }
      return w * size / 1000;
    }
    /* → [{face,text}] for a word, picking a face per character */
    async segment(word, style) {
      const scr = PL.ocr._scriptOfCode, segs = [];
      for (const ch of word) {
        const cp = ch.codePointAt(0);
        let face = null, sc = scr(cp);
        if (cp === 0x200C || cp === 0x200D) { if (segs.length) segs[segs.length - 1].text += ch; continue; }
        if (sc === 'latin') {
          const lf = await this.latin(style);
          if (lf.set.has(cp)) face = lf;
          else { const df = await this.script('dev'); if (df.set.has(cp)) face = df; }
        } else {
          if (sc === 'ara') this.rtl = true;
          const sf = await this.script(sc);
          if (sf.set.has(cp)) face = sf;
        }
        if (!face) continue;                                     // character not in any bundled font: dropped
        const last = segs[segs.length - 1];
        if (last && last.face === face) last.text += ch; else segs.push({ face, text: ch });
      }
      return segs;
    }
  }

  K.epubToPdf = async function (bytes, o, ctx) {
    ctx = ctx || {}; const prog = ctx.progress || noop;
    const { PDFDocument, StandardFonts, rgb } = PL.lib();
    prog(0.02, 'reading EPUB');
    const ep = K.readEpub(bytes);
    const doc = await PDFDocument.create();
    const faces = new Faces(doc);
    const PAGES = { a5: [419.53, 595.28], a4: [595.28, 841.89], letter: [612, 792], six: [432, 648] };
    const [PW, PH] = PAGES[o.page] || PAGES.a5;
    const base = +o.size || 11, M = Math.round(Math.min(PW, PH) * 0.1);
    const CW = PW - 2 * M, CH = PH - 2 * M - 8;
    const LH = 1.38;
    const courier = await doc.embedFont(StandardFonts.Courier);
    const cset = new Set(courier.getCharacterSet());
    let page = null, y = 0, warn = 0, imgs = 0;
    const imgCache = new Map();
    const outline = [];
    const newPage = () => { page = doc.addPage([PW, PH]); y = PH - M; return page; };

    async function embedImage(path) {
      if (imgCache.has(path)) return imgCache.get(path);
      const data = ep.get(path); let r = null;
      if (data) {
        try {
          const ext = extOf(path);
          if (ext === 'svg') { r = null; }
          else r = await embedAny(doc, data, path, 0);
        } catch (e) { r = null; }
      }
      imgCache.set(path, r); return r;
    }

    /* cover */
    if (ep.cover && !o.nocover) {
      const r = await embedImage(ep.cover);
      if (r) {
        newPage(); const sc = Math.min(PW / r.w, PH / r.h); const w = r.w * sc, h = r.h * sc;
        page.drawImage(r.image, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
        outline.push({ title: ep.title || 'Cover', page: 0 }); page = null;
      }
    }

    const ink = rgb(0.1, 0.1, 0.1);
    /* greedy line breaking over [{text,b,i}] runs → lines of [{face,text,w}] */
    async function layout(runs, width, size, indent) {
      const lines = []; let cur = [], curW = 0, first = true;
      const limit = () => width - (first ? indent : 0);
      const spaceW = {};
      const sp = async st => { if (spaceW[st] == null) { const f = await faces.latin(st); spaceW[st] = faces.width(f, ' ', size); } return spaceW[st]; };
      const push = (face, text, w) => {
        const last = cur[cur.length - 1];
        if (last && last.face === face) { last.text += text; last.w = null; } else cur.push({ face, text, w });
      };
      const wOf = it => { if (it.w == null) it.w = faces.width(it.face, it.text, size); return it.w; };
      const endLine = () => { lines.push({ items: cur, width: curW, first }); cur = []; curW = 0; first = false; };
      for (const run of runs) {
        const st = run.b && run.i ? 'bi' : run.b ? 'b' : run.i ? 'i' : 'r';
        const parts = run.text.split(/(\u2028| +)/);
        for (const part of parts) {
          if (!part) continue;
          if (part === '\u2028') { endLine(); continue; }
          if (/^ +$/.test(part)) {
            if (cur.length) { const w = await sp(st); if (curW + w <= limit()) { const lf = await faces.latin(st); push(lf, ' ', w); curW += w; } else endLine(); }
            continue;
          }
          const segs = await faces.segment(part.normalize('NFC').replace(/\u00A0/g, ' '), st);
          if (!segs.length) continue;
          let ww = 0; segs.forEach(s => { s.w = faces.width(s.face, s.text, size); ww += s.w; });
          if (curW + ww > limit() && cur.length) {
            // drop the trailing space of the finished line
            const lastI = cur[cur.length - 1];
            if (lastI && /\s$/.test(lastI.text)) { lastI.text = lastI.text.replace(/\s+$/, ''); lastI.w = null; }
            endLine();
          }
          if (ww > limit()) {                                   // a single token wider than the line: split by characters
            for (const s of segs) {
              for (const ch of s.text) {
                const cw = faces.width(s.face, ch, size);
                if (curW + cw > limit() && cur.length) endLine();
                push(s.face, ch, null); curW += cw;
              }
            }
            continue;
          }
          segs.forEach(s => { push(s.face, s.text, null); });
          curW += ww;
        }
      }
      if (cur.length || !lines.length) { const lastI = cur[cur.length - 1]; if (lastI && /\s$/.test(lastI.text)) lastI.text = lastI.text.replace(/\s+$/, ''); if (cur.length) endLine(); }
      // final widths for alignment
      lines.forEach(l => { l.width = l.items.reduce((n, it) => n + wOf(it), 0); });
      return lines;
    }

    function drawItem(item, x, yy, size, color) {
      const f = item.face;
      try { page.drawText(item.text, { x, y: yy, size, font: f.font, color }); }
      catch (e) {
        if (f.key.startsWith('script-') && !f.plain) { faces.forcePlain(f); try { page.drawText(item.text, { x, y: yy, size, font: f.font, color }); } catch (e2) { warn++; } }
        else warn++;
      }
    }

    async function setBlock(runs, size, opt) {
      opt = opt || {};
      const left = M + (opt.indentX || 0), width = CW - (opt.indentX || 0);
      const lines = await layout(runs, width - (opt.bullet ? 14 : 0), size, opt.firstIndent || 0);
      const lh = size * LH;
      if (opt.keepNext && page && y - lh * (lines.length + 2) < M) newPage();
      if (opt.before) y -= opt.before;
      for (let li = 0; li < lines.length; li++) {
        if (!page || y - lh < M) newPage();
        const L = lines[li]; y -= lh;
        const bx = left + (opt.bullet ? 14 : 0);
        let x = bx + (L.first ? (opt.firstIndent || 0) : 0);
        const avail = width - (opt.bullet ? 14 : 0) - (L.first ? (opt.firstIndent || 0) : 0);
        if (opt.align === 'center') x += Math.max(0, (avail - L.width) / 2);
        else if (opt.align === 'right') x += Math.max(0, avail - L.width);
        if (li === 0 && opt.bullet) {
          const lf = await faces.latin('r');
          drawItem({ face: lf, text: opt.bullet }, left, y + size * 0.28, size, ink);
        }
        let xx = x;
        L.items.forEach(it => { drawItem(it, xx, y + size * 0.28, size, ink); xx += it.w; });
      }
      if (opt.after) y -= opt.after;
      return lines.length;
    }

    const chapters = ep.spine;
    let curTitle = '';
    for (let ci = 0; ci < chapters.length; ci++) {
      PL.abortIf(ctx); prog(0.05 + 0.9 * ci / chapters.length, 'chapter ' + (ci + 1) + '/' + chapters.length);
      const ch = chapters[ci];
      const src = ep.text(ch.href);
      let dom = parseXml(src, 'application/xhtml+xml');
      if (!dom) dom = new DOMParser().parseFromString(src, 'text/html');
      const { blocks } = extractBlocks(dom);
      if (!blocks.length) continue;
      // chapters start on a new page
      page = null;
      const startPage = doc.getPageCount();
      let titled = false;
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (bi % 25 === 0) await PL.tick();
        if (!page) newPage();
        if (b.t === 'h') {
          if (!titled) { titled = true; if (!curTitle) curTitle = ''; outline.push({ title: b.runs.map(r => r.text).join('').slice(0, 120), page: doc.getPageCount() - 1 }); }
          const size = base * ({ 1: 1.9, 2: 1.55, 3: 1.3, 4: 1.15 }[b.level] || 1.05);
          await setBlock(b.runs.map(r => ({ ...r, b: true })), size, { align: b.align || (b.level === 1 ? 'center' : ''), before: b.level <= 2 ? base * 0.9 : base * 0.5, after: base * 0.5, keepNext: true });
        } else if (b.t === 'p') {
          await setBlock(b.runs, base, { align: b.align, indentX: b.quote * 22 + (b.depth ? b.depth * 14 : 0), bullet: b.bullet, after: base * (b.bullet ? 0.25 : 0.55), firstIndent: 0 });
        } else if (b.t === 'pre') {
          const lines = b.text.split('\n'), size = base * 0.82, lh = size * 1.3;
          y -= base * 0.2;
          for (const ln of lines) {
            if (!page || y - lh < M) newPage();
            y -= lh;
            let txt = Array.from(ln.replace(/\t/g, '    ')).filter(c => cset.has(c.codePointAt(0))).join('');
            while (txt.length) {                                   // hard-wrap long code lines at the column limit
              let n = txt.length;
              while (n > 1 && courier.widthOfTextAtSize(txt.slice(0, n), size) > CW) n--;
              page.drawText(txt.slice(0, n), { x: M, y: y + size * 0.25, size, font: courier, color: ink });
              txt = txt.slice(n);
              if (txt.length) { if (y - lh < M) newPage(); y -= lh; }
            }
          }
          y -= base * 0.5;
        } else if (b.t === 'hr') {
          if (!page || y - base < M) newPage();
          y -= base * 0.6; page.drawLine({ start: { x: M + CW * 0.25, y }, end: { x: M + CW * 0.75, y }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) }); y -= base * 0.6;
        } else if (b.t === 'img') {
          const path = resolvePath(ch.href, decodeHref(b.href));
          const r = await embedImage(path);
          if (!r) { warn++; continue; }
          imgs++;
          let w = Math.min(r.w * 0.75, CW), h = r.h * (w / r.w);
          if (h > CH) { h = CH; w = r.w * (h / r.h); }
          const own = h > CH * 0.6;                               // big pictures (covers, comic pages) get a page of their own
          if (own && y < PH - M - 1) newPage();
          if (!page || y - h < M) newPage();
          y -= h; page.drawImage(r.image, { x: M + (CW - w) / 2, y, width: w, height: h }); y -= base * 0.7;
          if (own) page = null;
        }
      }
      if (!titled && ep.titles[ch.href]) outline.push({ title: ep.titles[ch.href], page: startPage });
      else if (!titled && doc.getPageCount() > startPage) outline.push({ title: 'Section ' + (ci + 1), page: startPage });
    }
    if (!doc.getPageCount()) throw new Error('No readable content found in this EPUB');

    /* page numbers */
    const hv = await doc.embedFont(StandardFonts.Helvetica);
    const total = doc.getPageCount();
    if (!o.nonum) doc.getPages().forEach((p, i) => {
      if (ep.cover && i === 0 && outline[0] && outline[0].page === 0 && !o.nocover) return;
      const t = String(i + 1), w = hv.widthOfTextAtSize(t, 8);
      p.drawText(t, { x: (PW - w) / 2, y: M * 0.45, size: 8, font: hv, color: rgb(0.45, 0.45, 0.45) });
    });
    /* bookmarks */
    if (outline.length) {
      const c = doc.context, L = PL.lib();
      const outRef = c.nextRef(), refs = outline.map(() => c.nextRef());
      outline.forEach((it, i) => {
        const d = { Title: L.PDFHexString.fromText(it.title || ('Section ' + (i + 1))), Parent: outRef, Dest: [doc.getPage(Math.min(it.page, total - 1)).ref, L.PDFName.of('Fit')] };
        if (i > 0) d.Prev = refs[i - 1]; if (i < outline.length - 1) d.Next = refs[i + 1];
        c.assign(refs[i], c.obj(d));
      });
      c.assign(outRef, c.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: outline.length }));
      doc.catalog.set(L.PDFName.of('Outlines'), outRef);
    }
    try { if (ep.title) doc.setTitle(ep.title); if (ep.author) doc.setAuthor(ep.author); } catch (e) { /* ignore */ }
    const notes = [];
    if (faces.rtl) notes.push('contains right-to-left text (Urdu/Arabic) — line order may be wrong');
    if (warn) notes.push(warn + ' item(s) skipped (unsupported image or glyph)');
    prog(0.98, 'saving');
    return { bytes: await doc.save(), note: chapters.length + ' chapters · ' + total + ' pages' + (notes.length ? ' · ' + notes.join('; ') : ''), warnings: notes };
  };

  ops.epub2pdf = {
    id: 'epub2pdf', label: 'E-book (EPUB) → PDF', group: 'Books & comics', accepts: ['epub'], suffix: '', ext: 'pdf',
    fields: [
      { id: 'page', label: 'Page size', type: 'select', value: 'a5', options: [['a5', 'A5 (book)'], ['six', '6 × 9 in'], ['a4', 'A4'], ['letter', 'Letter']] },
      { id: 'size', label: 'Text size', type: 'select', value: '11', options: [['10', 'Small'], ['11', 'Normal'], ['13', 'Large'], ['15', 'Extra large']] },
      { id: 'nonum', label: 'Skip page numbers', type: 'check', value: false }
    ],
    run: (bytes, o, ctx) => K.epubToPdf(bytes, o, ctx)
  };

  /* ───────────────────────── PDF → EPUB ───────────────────────── */
  function langOfText(s) {
    const scr = PL.ocr._scriptOfCode, c = {};
    for (const ch of s.slice(0, 4000)) { const k = scr(ch.codePointAt(0)); c[k] = (c[k] || 0) + 1; }
    delete c.latin;
    const best = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
    return ({ dev: 'hi', ben: 'bn', tel: 'te', tam: 'ta', kan: 'kn', mal: 'ml', guj: 'gu', gur: 'pa', ori: 'or', ara: 'ur' })[best] || 'en';
  }

  /* pdf.js text items → paragraphs {text, h:1|2|3|0} for one page */
  async function pageParagraphs(page) {
    const tc = await page.getTextContent();
    const its = tc.items.filter(it => it.str != null && it.transform);
    if (!its.length) return [];
    // lines: break when baseline moves, or x goes backwards a lot
    const lines = []; let cur = null;
    its.forEach(it => {
      const x = it.transform[4], yy = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      if (!it.str.length && !it.hasEOL) return;
      const newLine = !cur || Math.abs(yy - cur.y) > h * 0.55 || x < cur.endX - h * 4;
      if (newLine) { cur = { y: yy, h, x0: x, endX: x + (it.width || 0), text: '' }; lines.push(cur); }
      // space between items on the same line if there is a visible gap
      if (cur.text && x - cur.endX > h * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
      cur.text += it.str; cur.endX = Math.max(cur.endX, x + (it.width || 0)); cur.h = Math.max(cur.h, h);
      if (it.hasEOL) cur = null;
    });
    const ls = lines.map(l => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter(l => l.text);
    if (!ls.length) return [];
    const hs = ls.map(l => l.h).sort((a, b) => a - b), med = hs[Math.floor(hs.length / 2)] || 10;
    const gaps = []; for (let i = 1; i < ls.length; i++) { const g = ls[i - 1].y - ls[i].y; if (g > 0) gaps.push(g); }
    gaps.sort((a, b) => a - b); const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : med * 1.3;
    const maxW = Math.max(...ls.map(l => l.endX - l.x0));
    const paras = []; let p = null;
    ls.forEach((l, i) => {
      const heading = l.h > med * 1.22 && l.text.length < 140 ? (l.h > med * 1.7 ? 1 : l.h > med * 1.4 ? 2 : 3) : 0;
      const prev = ls[i - 1];
      const gap = prev ? prev.y - l.y : 0;
      const prevShort = prev && (prev.endX - prev.x0) < maxW * 0.6 && /[.!?:।…”"')\]]$/.test(prev.text);
      const brk = !p || heading || p.h || gap > pitch * 1.45 || gap <= 0 || prevShort;
      if (brk) { p = { text: l.text, h: heading }; paras.push(p); }
      else {
        if (/[A-Za-zÀ-ɏ]-$/.test(p.text) && /^[a-zà-ɏ]/.test(l.text)) p.text = p.text.slice(0, -1) + l.text;   // de-hyphenate
        else p.text += ' ' + l.text;
      }
    });
    return paras;
  }

  const EPUB_CSS = 'body{font-family:serif;line-height:1.45;margin:0 .6em}h1,h2,h3{font-family:sans-serif;line-height:1.25}h1{font-size:1.7em;margin:1.2em 0 .6em}h2{font-size:1.35em;margin:1.1em 0 .5em}h3{font-size:1.15em;margin:1em 0 .4em}p{margin:0 0 .75em 0;text-align:left}img{max-width:100%;height:auto}';

  ops.pdf2epub = {
    id: 'pdf2epub', label: 'PDF → E-book (EPUB)', group: 'Books & comics', accepts: ['pdf'], suffix: '', ext: 'epub',
    fields: [
      { id: 'mode', label: 'Layout', type: 'select', value: 'text', options: [['text', 'Reflowable text (best for reading on phones)'], ['pages', 'Page images (looks exactly like the PDF)']] },
      { id: 'per', label: 'Chapter length', type: 'select', value: '10', options: [['1', 'Every page'], ['5', '5 pages'], ['10', '10 pages'], ['25', '25 pages']] }
    ],
    async run(bytes, o, ctx) {
      ctx = ctx || {}; const prog = ctx.progress || noop;
      const pdf = await PL.openPdfjs(bytes);
      try {
        const n = pdf.numPages, per = Math.max(1, +o.per || 10);
        let meta = {}; try { meta = (await pdf.getMetadata()).info || {}; } catch (e) { /* none */ }
        const title = (meta.Title || (ctx.name || 'Book').replace(/\.pdf$/i, '')).trim() || 'Book';
        const author = (meta.Author || '').trim();
        // text of every page first (also decides whether the PDF has a text layer at all)
        let mode = o.mode === 'pages' ? 'pages' : 'text';
        const pageParas = [];
        if (mode === 'text') {
          let chars = 0;
          for (let i = 1; i <= n; i++) {
            PL.abortIf(ctx); prog(0.02 + 0.4 * (i - 1) / n, 'reading text ' + i + '/' + n);
            const pg = await pdf.getPage(i); const ps = await pageParagraphs(pg); pg.cleanup();
            pageParas.push(ps); ps.forEach(p => { chars += p.text.length; });
            if (i % 8 === 0) await PL.tick();
          }
          if (chars < 20 * Math.min(n, 5)) { mode = 'pages'; }     // scanned / image-only PDF
        }
        const fallbackNote = (o.mode !== 'pages' && mode === 'pages') ? ' · no text layer found — used page images (run Searchable first for reflowable text)' : '';
        const lang = mode === 'text' ? langOfText(pageParas.flat().map(p => p.text).join(' ')) : 'en';
        const files = {};
        const items = [];                                      // {id, href, title, props, media}
        const manifestExtra = [];
        const dpr = mode === 'pages' ? 1.6 : 0.9;
        // cover = page 1
        let coverName = null;
        { PL.abortIf(ctx); prog(0.45, 'cover');
          const pg = await pdf.getPage(1); const { cv } = await PL.renderPage(pg, mode === 'pages' ? dpr : 0.9);
          coverName = 'images/cover.jpg'; files['OEBPS/' + coverName] = [await canvasBytes(cv, 'image/jpeg', 0.82), { level: 0 }]; PL.freeCanvas(cv); pg.cleanup(); }
        const xhead = t => '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' + lang + '" xml:lang="' + lang + '">\n<head><meta charset="utf-8"/><title>' + xesc(t) + '</title><link rel="stylesheet" type="text/css" href="style.css"/>';
        if (mode === 'text') {
          let ch = 0;
          for (let start = 0; start < n; start += per) {
            const end = Math.min(n, start + per);
            let body = '', chTitle = '';
            for (let i = start; i < end; i++) {
              pageParas[i].forEach(p => {
                if (p.h) { const lv = Math.min(3, Math.max(1, p.h)); if (!chTitle) chTitle = p.text; body += '<h' + lv + '>' + xesc(p.text) + '</h' + lv + '>\n'; }
                else body += '<p>' + xesc(p.text) + '</p>\n';
              });
            }
            if (!body.trim()) continue;
            ch++; const id = 'c' + String(ch).padStart(3, '0');
            const t = (chTitle || ('Pages ' + (start + 1) + (end > start + 1 ? '–' + end : ''))).slice(0, 100);
            files['OEBPS/' + id + '.xhtml'] = te.encode(xhead(t) + '</head>\n<body>\n' + body + '</body>\n</html>\n');
            items.push({ id, href: id + '.xhtml', title: t });
          }
        } else {
          for (let i = 1; i <= n; i++) {
            PL.abortIf(ctx); prog(0.45 + 0.5 * (i - 1) / n, 'page ' + i + '/' + n);
            const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: 1 });
            const { cv } = await PL.renderPage(pg, dpr); const img = await canvasBytes(cv, 'image/jpeg', 0.82); PL.freeCanvas(cv); pg.cleanup();
            const nm = 'images/p' + String(i).padStart(4, '0') + '.jpg', id = 'p' + String(i).padStart(4, '0');
            files['OEBPS/' + nm] = [img, { level: 0 }];
            manifestExtra.push('<item id="img-' + id + '" href="' + nm + '" media-type="image/jpeg"/>');
            const w = Math.round(vp.width), h = Math.round(vp.height);
            files['OEBPS/' + id + '.xhtml'] = te.encode('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">\n<head><meta charset="utf-8"/><title>Page ' + i + '</title><meta name="viewport" content="width=' + w + ', height=' + h + '"/><style>html,body{margin:0;padding:0}img{display:block;width:' + w + 'px;height:' + h + 'px}</style></head>\n<body><img src="' + nm + '" alt="Page ' + i + '"/></body>\n</html>\n');
            items.push({ id, href: id + '.xhtml', title: 'Page ' + i, fixed: true });
            if (i % 3 === 0) await PL.tick();
          }
        }
        if (!items.length) throw new Error('Nothing to convert — the PDF has no pages with content');
        prog(0.96, 'packing');
        const uid = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
        const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        const fixed = mode === 'pages';
        files['OEBPS/style.css'] = te.encode(EPUB_CSS);
        const man = [
          '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
          '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
          '<item id="css" href="style.css" media-type="text/css"/>',
          '<item id="cover-img" href="' + coverName + '" media-type="image/jpeg" properties="cover-image"/>'
        ].concat(items.map(it => '<item id="' + it.id + '" href="' + it.href + '" media-type="application/xhtml+xml"/>'), manifestExtra);
        files['OEBPS/content.opf'] = te.encode('<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' + lang + '">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="bookid">' + uid + '</dc:identifier>\n<dc:title>' + xesc(title) + '</dc:title>\n' + (author ? '<dc:creator>' + xesc(author) + '</dc:creator>\n' : '') + '<dc:language>' + lang + '</dc:language>\n<meta property="dcterms:modified">' + now + '</meta>\n<meta name="cover" content="cover-img"/>\n' + (fixed ? '<meta property="rendition:layout">pre-paginated</meta>\n<meta property="rendition:spread">none</meta>\n' : '') + '</metadata>\n<manifest>\n' + man.join('\n') + '\n</manifest>\n<spine toc="ncx">\n' + items.map(it => '<itemref idref="' + it.id + '"' + (fixed ? ' properties="rendition:page-spread-center"' : '') + '/>').join('\n') + '\n</spine>\n</package>\n');
        files['OEBPS/nav.xhtml'] = te.encode('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' + lang + '" xml:lang="' + lang + '">\n<head><meta charset="utf-8"/><title>Contents</title></head>\n<body>\n<nav epub:type="toc" id="toc"><h1>Contents</h1>\n<ol>\n' + items.map(it => '<li><a href="' + it.href + '">' + xesc(it.title) + '</a></li>').join('\n') + '\n</ol></nav>\n</body>\n</html>\n');
        files['OEBPS/toc.ncx'] = te.encode('<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n<head><meta name="dtb:uid" content="' + uid + '"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>\n<docTitle><text>' + xesc(title) + '</text></docTitle>\n<navMap>\n' + items.map((it, i) => '<navPoint id="n' + (i + 1) + '" playOrder="' + (i + 1) + '"><navLabel><text>' + xesc(it.title) + '</text></navLabel><content src="' + it.href + '"/></navPoint>').join('\n') + '\n</navMap>\n</ncx>\n');
        files['META-INF/container.xml'] = te.encode('<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n');
        // the mimetype entry must be first and stored uncompressed
        const ordered = { mimetype: [te.encode('application/epub+zip'), { level: 0 }] };
        Object.keys(files).forEach(k => { ordered[k] = files[k]; });
        return { bytes: F().zipSync(ordered), note: (fixed ? 'fixed layout · ' : 'reflowable · ') + items.length + ' sections' + fallbackNote };
      } finally { pdf.destroy(); }
    }
  };
})(window.PaperLab);
