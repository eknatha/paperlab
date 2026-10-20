/* PaperLab — PDF → Word / Excel / PowerPoint.  Runs entirely in the browser.
   Layout analysis: js/convert/layout.js   ·   file writers: js/convert/ooxml.js   ·   shared with Mass Batch via PL.ops. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const C = PL.convert = PL.convert || {};
  const noop = () => {};
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  async function needsOcr(bytes) {
    let pdf; try { pdf = await PL.openPdfjs(bytes); } catch (e) { throw e; }
    try {
      let n = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i), tc = await pg.getTextContent();
        if (tc.items.reduce((a, it) => a + it.str.replace(/\s/g, '').length, 0) < 12) n++;
        pg.cleanup();
      }
      return n;
    } finally { pdf.destroy(); }
  }

  /* run OCR first when asked and when some pages have no text */
  async function prepare(bytes, o, ctx) {
    ctx = ctx || {};
    if (!bytes || !bytes.length) throw new Error('Empty file (0 bytes)');
    const prog = ctx.progress || noop;
    let ocrPages = 0, src = bytes;
    if (o.ocr && PL.ops.searchable) {
      prog(0.02, 'checking for scanned pages');
      ocrPages = await needsOcr(bytes);
      PL.abortIf(ctx);
      if (ocrPages) {
        const r = await PL.ops.searchable.run(bytes, { lang: o.lang || 'eng', eng: true, dpi: '200', skipText: true, enhance: true, wantText: false }, { signal: ctx.signal, name: ctx.name, progress: (f, m) => prog(0.03 + f * 0.5, 'OCR — ' + m) });
        src = r.bytes;
      }
    }
    return { src, ocrPages };
  }

  async function analyze(bytes, aopt, ctx, ocrWork) {
    const prog = (ctx && ctx.progress) || noop;
    const pdf = await PL.openPdfjs(bytes);
    try {
      const sub = Object.assign({}, ctx, { progress: (f, m) => prog((ocrWork ? 0.5 : 0) + f * (ocrWork ? 0.4 : 0.8), m) });
      return await C.analyze(pdf, aopt, sub);
    } finally { pdf.destroy(); }
  }

  function summary(doc, extra) {
    const pics = doc.pages.reduce((a, p) => a + p.blocks.filter(b => b.kind === 'img').length, 0);
    const parts = [plural(doc.pages.length, 'page')];
    if (doc.tableCount) parts.push(plural(doc.tableCount, 'table'));
    if (pics) parts.push(plural(pics, 'picture'));
    return parts.join(' · ') + (extra ? ' · ' + extra : '');
  }
  function warnings(doc, ocrPages, o) {
    const w = [];
    if (doc.scannedPages && !ocrPages) w.push(plural(doc.scannedPages, 'page') + ' had no text (scans) — kept as pictures. Tick “Recognise text in scanned pages” to turn them into editable text.');
    if (ocrPages) w.push('OCR was used on ' + plural(ocrPages, 'scanned page') + ' — proofread the recognised text.');
    if (doc.imgSkipped) w.push(plural(doc.imgSkipped, 'picture') + ' skipped to stay within browser memory.');
    if (doc.removedHF) w.push('Removed ' + plural(doc.removedHF, 'repeated header/footer/page number') + '.');
    if (!doc.chars && !doc.scannedPages) w.push('No text was found in this PDF.');
    return w;
  }

  /* ───────── Word ───────── */
  C.toDocx = async function (bytes, o, ctx) {
    o = o || {}; ctx = ctx || {}; const prog = ctx.progress || noop;
    const { src, ocrPages } = await prepare(bytes, o, ctx);
    const doc = await analyze(src, { images: o.pictures !== false, hf: o.hf !== false, scale: 2, colors: true }, ctx, ocrPages > 0);
    PL.abortIf(ctx); prog(0.93, 'writing the Word file');
    const out = C.docx(doc, { pageBreaks: o.pageBreaks !== false, title: (ctx.name || '').replace(/\.[^.]*$/, '') });
    return { bytes: out, ext: 'docx', note: summary(doc), report: { warnings: warnings(doc, ocrPages, o) } };
  };

  /* ───────── Excel ───────── */
  C.toXlsx = async function (bytes, o, ctx) {
    o = o || {}; ctx = ctx || {}; const prog = ctx.progress || noop;
    const { src, ocrPages } = await prepare(bytes, o, ctx);
    const doc = await analyze(src, { images: false, hf: o.hf === true }, ctx, ocrPages > 0);
    PL.abortIf(ctx); prog(0.93, 'writing the Excel file');
    const sheets = []; let mode = o.mode === 'pages' ? 'pages' : 'tables';
    const w = warnings(doc, ocrPages, o);
    if (mode === 'tables' && !doc.tableCount) { mode = 'pages'; w.push('No tables were detected — put the text of every page on its own sheet instead.'); }
    const gridRows = t => t.rows.map(r => r.map(c => ({ text: c.text, bold: c.bold })));
    if (mode === 'tables') {
      doc.pages.forEach(pm => { let k = 0; pm.blocks.forEach(b => { if (b.kind === 'table') { k++; sheets.push({ name: 'P' + pm.no + ' Table ' + k, rows: gridRows(b) }); } }); });
    } else {
      doc.pages.forEach(pm => {
        const rows = [];
        pm.blocks.forEach(b => {
          if (b.kind === 'p') rows.push([{ text: b.text.replace(/\t+/g, '  '), bold: b.heading > 0 }]);
          else if (b.kind === 'table') { gridRows(b).forEach(r => rows.push(r)); rows.push([]); }
        });
        sheets.push({ name: 'Page ' + pm.no, rows });
      });
    }
    const out = C.xlsx(sheets, { numbers: o.numbers !== false, title: (ctx.name || '').replace(/\.[^.]*$/, '') });
    return { bytes: out, ext: 'xlsx', note: plural(sheets.length, 'sheet') + (doc.tableCount ? ' · ' + plural(doc.tableCount, 'table') : ''), report: { warnings: w } };
  };

  /* ───────── PowerPoint ───────── */
  C.toPptx = async function (bytes, o, ctx) {
    o = o || {}; ctx = ctx || {}; const prog = ctx.progress || noop;
    const exact = o.mode === 'exact';
    const { src, ocrPages } = await prepare(bytes, o, ctx);
    const aopt = exact ? { images: false, hf: false, bg: 'page', scale: 1.6, bgQuality: 0.85 }
      : { images: o.pictures !== false, hf: false, bg: o.graphics === false ? null : 'whiten', scale: 1.6, colors: true };
    const doc = await analyze(src, aopt, ctx, ocrPages > 0);
    if (exact) doc.pages.forEach(pm => { pm.blocks = []; });
    PL.abortIf(ctx); prog(0.93, 'writing the PowerPoint file');
    const out = C.pptx(doc, { title: (ctx.name || '').replace(/\.[^.]*$/, '') });
    const w = warnings(doc, ocrPages, o);
    if (!exact) w.push('Charts and drawings are kept as a picture behind the text (when “Keep graphics” is on); they are not editable.');
    return { bytes: out, ext: 'pptx', note: plural(doc.pages.length, 'slide') + (exact ? ' (page images)' : ''), report: { warnings: w } };
  };

  /* ───────── shared operations ───────── */
  PL.ops = PL.ops || {};
  const OCR_FIELDS = () => {
    const l = PL.ops.searchable && PL.ops.searchable.fields.find(f => f.id === 'lang');
    return [
      { id: 'ocr', label: 'Recognise text in scanned pages first (OCR)', type: 'check', value: false },
      l ? { id: 'lang', label: 'Scan language', type: 'select', value: 'eng', options: l.options, showIf: ['ocr', true] } : null
    ].filter(Boolean);
  };
  const mk = (id, label, ext, run, fields, note) => (PL.ops[id] = { id, label, group: 'Office', accepts: ['pdf'], suffix: '', ext, heavy: true, fields, note, run });
  mk('pdf2docx', 'PDF → Word (.docx)', 'docx', C.toDocx, [
    { id: 'pictures', label: 'Include pictures', type: 'check', value: true },
    { id: 'hf', label: 'Remove repeated headers, footers and page numbers', type: 'check', value: true },
    { id: 'pageBreaks', label: 'Start each PDF page on a new page', type: 'check', value: true }
  ].concat(OCR_FIELDS()));
  mk('pdf2xlsx', 'PDF → Excel (.xlsx)', 'xlsx', C.toXlsx, [
    { id: 'mode', label: 'What to export', type: 'select', value: 'tables', options: [['tables', 'Tables only (one sheet per table)'], ['pages', 'Everything in reading order (one sheet per page)']] },
    { id: 'numbers', label: 'Turn numbers into numeric cells (12,345.60 → 12345.6)', type: 'check', value: true }
  ].concat(OCR_FIELDS()));
  mk('pdf2pptx', 'PDF → PowerPoint (.pptx)', 'pptx', C.toPptx, [
    { id: 'mode', label: 'Slides', type: 'select', value: 'editable', options: [['editable', 'Editable (text boxes, tables, pictures)'], ['exact', 'Exact look (each page as an image)']] },
    { id: 'graphics', label: 'Keep graphics, charts and colours behind the text', type: 'check', value: true, showIf: ['mode', 'editable'] },
    { id: 'pictures', label: 'Include pictures', type: 'check', value: true, showIf: ['mode', 'editable'] }
  ].concat(OCR_FIELDS()));
  // suffix: keep the original stem; the extension tells the formats apart
  ['pdf2docx', 'pdf2xlsx', 'pdf2pptx'].forEach(id => { PL.ops[id].suffix = ''; });
})(window.PaperLab);
