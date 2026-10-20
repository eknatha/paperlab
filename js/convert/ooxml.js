/* Patram — minimal OOXML writers (Word, Excel, PowerPoint) on top of fflate. No external libraries. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const C = PL.convert = PL.convert || {};
  const esc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\u2028\u2029]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const enc = s => new TextEncoder().encode(s);
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const tw = pt => Math.round(pt * 20), emu = pt => Math.round(pt * 12700);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function zip(files) {                                   // files: {path: string|Uint8Array}; [Content_Types].xml first
    const z = {}; const order = Object.keys(files).sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
    order.forEach(k => { z[k] = [typeof files[k] === 'string' ? enc(files[k]) : files[k], { level: /\.(jpe?g|png)$/i.test(k) ? 0 : 6 }]; });
    return window.fflate.zipSync(z);
  }
  const fontFor = r => r.m ? 'Courier New' : r.s ? 'Times New Roman' : 'Arial';
  const rels = items => XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + items.map(([id, type, target]) => '<Relationship Id="' + id + '" Type="' + type + '" Target="' + target + '"/>').join('') + '</Relationships>';
  const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const core = title => XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + esc(title || '') + '</dc:title><dc:creator>Patram</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created></cp:coreProperties>';
  const REL_CORE = ['rIdC', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'];

  /* ═════════════════ WORD ═════════════════ */
  C.docx = function (doc, o) {
    o = o || {};
    const pages = doc.pages, body = doc.body;
    const P1 = pages[0] || { W: 595, H: 842 };
    // margins: typical left/right/top/bottom of the content, clamped to sane values
    const ms = { l: [], r: [], t: [], b: [] };
    pages.forEach(pm => { const bl = pm.blocks.filter(b => b.kind === 'p' || b.kind === 'table'); if (!bl.length) return; ms.l.push(Math.min.apply(null, bl.map(b => b.x0))); ms.r.push(pm.W - Math.max.apply(null, bl.map(b => b.x1))); ms.t.push(Math.min.apply(null, bl.map(b => b.top))); ms.b.push(pm.H - Math.max.apply(null, bl.map(b => b.bottom))); });
    const mid = a => { if (!a.length) return 54; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const mL = clamp(mid(ms.l), 28, 120), mR = clamp(mid(ms.r), 28, 120), mT = clamp(mid(ms.t), 28, 100), mB = clamp(mid(ms.b), 28, 100);
    const cw = P1.W - mL - mR;                                  // content width in pt
    const media = {}; const relList = []; let rid = 10, did = 1;

    const run = r => {
      const f = fontFor(r), sz = Math.round(r.sz * 2);
      const parts = String(r.t).split('\t');
      const inner = parts.map((p, i) => (i ? '<w:tab/>' : '') + (p ? '<w:t xml:space="preserve">' + esc(p) + '</w:t>' : '')).join('');
      return '<w:r><w:rPr><w:rFonts w:ascii="' + f + '" w:hAnsi="' + f + '" w:cs="' + f + '" w:eastAsia="' + f + '"/>' + (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.c && r.c !== '000000' ? '<w:color w:val="' + r.c + '"/>' : '') + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>' + inner + '</w:r>';
    };
    const para = (b, first) => {
      const style = b.heading ? 'Heading' + Math.min(3, b.heading) : b.list ? 'ListParagraph' : '';
      const ind = b.x0 - mL;
      const pPr = (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (first ? '<w:pageBreakBefore/>' : '')
        + (!b.heading && ind > 10 && ind < 70 && !b.list ? '<w:ind w:left="' + tw(ind) + '"/>' : '') + (b.center ? '<w:jc w:val="center"/>' : '');
      // headings keep their style's look; body keeps per-run formatting
      const runs = b.heading ? b.runs.map(r => Object.assign({}, r, { sz: undefined })).map((r, i) => Object.assign(r, { sz: Math.max(b.runs[i].sz, body) })) : b.runs;
      return '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + runs.map(run).join('') + '</w:p>';
    };
    const table = (t, first) => {
      const n = t.edges.length, widths = t.edges.map(e => Math.max(30, e[1] - e[0] + 20)); const tot = widths.reduce((a, c) => a + c, 0), k = Math.min(1, cw / tot);
      const grid = widths.map(w => '<w:gridCol w:w="' + tw(w * k) + '"/>').join('');
      const rows = t.rows.map(r => '<w:tr>' + r.map((c, ci) => {
        const isNum = C._num(c.text) && c.text.length < 24;
        const runs = (c.runs && c.runs.length ? c.runs : [{ t: c.text, sz: t.size, b: false, i: false }]);
        const txt = c.text;
        const rr = runs.length === 1 ? [Object.assign({}, runs[0], { t: txt })] : [Object.assign({}, runs[0], { t: txt, b: c.bold })];
        return '<w:tc><w:tcPr><w:tcW w:w="' + tw(widths[ci] * k) + '" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/>' + (isNum ? '<w:jc w:val="right"/>' : '') + '</w:pPr>' + (txt ? rr.map(run).join('') : '') + '</w:p></w:tc>';
      }).join('') + '</w:tr>').join('');
      return (first ? '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:after="0"/></w:pPr></w:p>' : '') + '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + rows + '</w:tbl><w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>';
    };
    const picture = (b, first) => {
      if (!b.bytes) return '';
      const id = rid++, name = 'image' + id + '.jpg'; media['word/media/' + name] = b.bytes; relList.push(['rId' + id, RT + 'image', 'media/' + name]);
      let w = b.x1 - b.x0, h = b.bottom - b.top; if (w > cw) { h *= cw / w; w = cw; }
      const d = did++;
      return '<w:p><w:pPr>' + (first ? '<w:pageBreakBefore/>' : '') + (b.full ? '<w:spacing w:after="0"/>' : '') + '</w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + emu(w) + '" cy="' + emu(h) + '"/><wp:docPr id="' + d + '" name="Picture ' + d + '" descr="' + esc(b.full ? 'Scanned page' : 'Picture') + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + d + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + emu(w) + '" cy="' + emu(h) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    };

    let xml = '';
    pages.forEach((pm, pi) => {
      let first = o.pageBreaks !== false && pi > 0;
      const bl = pm.blocks;
      if (!bl.length) { xml += '<w:p>' + (first ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : '') + '</w:p>'; return; }
      bl.forEach(b => {
        xml += b.kind === 'p' ? para(b, first) : b.kind === 'table' ? table(b, first) : picture(b, first);
        first = false;
      });
    });
    if (!xml) xml = '<w:p/>';
    const sect = '<w:sectPr><w:pgSz w:w="' + tw(P1.W) + '" w:h="' + tw(P1.H) + '"/><w:pgMar w:top="' + tw(mT) + '" w:right="' + tw(mR) + '" w:bottom="' + tw(mB) + '" w:left="' + tw(mL) + '" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
    const base = Math.round(body * 2);
    const styles = XML + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="' + base + '"/><w:szCs w:val="' + base + '"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      + [1, 2, 3].map(n => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="' + (240 - n * 40) + '" w:after="100"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr><w:rPr><w:b/><w:sz w:val="' + Math.round(body * [1.8, 1.45, 1.2][n - 1] * 2) + '"/></w:rPr></w:style>').join('')
      + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="360"/></w:pPr></w:style>'
      + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
      + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/></w:tblBorders></w:tblPr></w:style></w:styles>';
    const hasJpg = Object.keys(media).length > 0;
    const ct = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + (hasJpg ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : '')
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    const files = {
      '[Content_Types].xml': ct,
      '_rels/.rels': rels([['rId1', RT + 'officeDocument', 'word/document.xml'], REL_CORE]),
      'word/document.xml': XML + '<w:document ' + NS + '><w:body>' + xml + sect + '</w:body></w:document>',
      'word/styles.xml': styles,
      'word/_rels/document.xml.rels': rels([['rId1', RT + 'styles', 'styles.xml']].concat(relList)),
      'docProps/core.xml': core(o.title)
    };
    Object.assign(files, media);
    return zip(files);
  };

  /* ═════════════════ EXCEL ═════════════════ */
  const colName = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  C.xlsx = function (sheets, o) {
    o = o || {};
    // sheets: [{ name, rows: [[ {text, bold?} | string ... ]] }]
    const sst = [], sidx = new Map();
    const si = t => { if (!sidx.has(t)) { sidx.set(t, sst.length); sst.push(t); } return sidx.get(t); };
    const STY = { num0: 1, num2: 2, pct0: 3, pct2: 4 };
    const used = new Set();
    const nameOf = (n, i) => { let s = String(n || 'Sheet' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet' + (i + 1); let k = 2, b = s; while (used.has(s.toLowerCase())) s = b.slice(0, 28) + ' ' + (k++); used.add(s.toLowerCase()); return s; };
    const sheetXml = sh => {
      const widths = [];
      const rowsXml = sh.rows.map((row, ri) => {
        const cells = row.map((c, ci) => {
          const text = typeof c === 'string' ? c : (c && c.text) || ''; if (!String(text).trim()) return '';
          widths[ci] = Math.max(widths[ci] || 8, Math.min(60, String(text).length + 2));
          const ref = colName(ci) + (ri + 1), n = o.numbers === false ? null : C._num(text);
          if (n) return '<c r="' + ref + '"' + (n.fmt ? ' s="' + STY[n.fmt] + '"' : '') + '><v>' + n.v + '</v></c>';
          return '<c r="' + ref + '" t="s"' + (c && c.bold ? ' s="5"' : '') + '><v>' + si(String(text).trim()) + '</v></c>';
        }).join('');
        return cells ? '<row r="' + (ri + 1) + '">' + cells + '</row>' : '';
      }).join('');
      const cols = widths.length ? '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (w || 8) + '" customWidth="1"/>').join('') + '</cols>' : '';
      return XML + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + rowsXml + '</sheetData></worksheet>';
    };
    if (!sheets.length) sheets = [{ name: 'Sheet1', rows: [] }];
    const names = sheets.map((s, i) => nameOf(s.name, i));
    const files = {};
    sheets.forEach((s, i) => { files['xl/worksheets/sheet' + (i + 1) + '.xml'] = sheetXml(s); });
    files['xl/sharedStrings.xml'] = XML + '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sst.length + '" uniqueCount="' + sst.length + '">' + sst.map(t => '<si><t xml:space="preserve">' + esc(t) + '</t></si>').join('') + '</sst>';
    files['xl/styles.xml'] = XML + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    files['xl/workbook.xml'] = XML + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>';
    files['xl/_rels/workbook.xml.rels'] = rels(sheets.map((s, i) => ['rId' + (i + 1), RT + 'worksheet', 'worksheets/sheet' + (i + 1) + '.xml']).concat([['rIdS', RT + 'styles', 'styles.xml'], ['rIdT', RT + 'sharedStrings', 'sharedStrings.xml']]));
    files['[Content_Types].xml'] = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    files['_rels/.rels'] = rels([['rId1', RT + 'officeDocument', 'xl/workbook.xml'], REL_CORE]);
    files['docProps/core.xml'] = core(o.title);
    return zip(files);
  };

  /* ═════════════════ POWERPOINT ═════════════════ */
  C.pptx = function (doc, o) {
    o = o || {};
    const pages = doc.pages, P1 = pages[0] || { W: 792, H: 612 };
    const SW = P1.W, SH = P1.H;
    const media = {}; let mid = 0;
    const slides = [];
    const addMedia = (bytes, ext) => { const n = 'image' + (++mid) + '.' + ext; media['ppt/media/' + n] = bytes; return n; };
    pages.forEach((pm, si) => {
      const sc = Math.min(SW / pm.W, SH / pm.H), ox = (SW - pm.W * sc) / 2, oy = (SH - pm.H * sc) / 2;
      const X = v => emu(ox + v * sc), Y = v => emu(oy + v * sc), L = v => emu(v * sc);
      let shapes = '', sid = 2; const srels = [];
      const pic = (bytes, x0, top, x1, bottom, descr) => {
        const n = addMedia(bytes, 'jpg'), rid = 'rId' + (srels.length + 2); srels.push([rid, RT + 'image', '../media/' + n]);
        shapes += '<p:pic><p:nvPicPr><p:cNvPr id="' + (sid++) + '" name="Picture ' + sid + '" descr="' + esc(descr || '') + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + X(x0) + '" y="' + Y(top) + '"/><a:ext cx="' + L(x1 - x0) + '" cy="' + L(bottom - top) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
      };
      if (pm.bgBytes) pic(pm.bgBytes, 0, 0, pm.W, pm.H, 'Page background');
      pm.blocks.forEach(b => {
        if (b.kind === 'img' && b.bytes) { if (!(pm.bgBytes && b.full)) pic(b.bytes, b.x0, b.top, b.x1, b.bottom, b.full ? 'Scanned page' : 'Picture'); }
        else if (b.kind === 'p') {
          const w = (b.x1 - b.x0) * 1.06 + 6, h = (b.bottom - b.top) * 1.08 + 4;
          const runs = b.runs.map(r => { const f = fontFor(r); return '<a:r><a:rPr lang="en-US" sz="' + Math.round(clamp(r.sz * sc, 4, 400) * 100) + '"' + (r.b || b.heading ? ' b="1"' : '') + (r.i ? ' i="1"' : '') + ' dirty="0"><a:solidFill><a:srgbClr val="' + (r.c || '000000') + '"/></a:solidFill><a:latin typeface="' + f + '"/><a:cs typeface="' + f + '"/></a:rPr><a:t>' + esc(r.t.replace(/\t/g, '    ')) + '</a:t></a:r>'; }).join('');
          shapes += '<p:sp><p:nvSpPr><p:cNvPr id="' + (sid++) + '" name="Text ' + sid + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + X(b.x0 - 3) + '" y="' + Y(b.top - 1) + '"/><a:ext cx="' + L(w) + '" cy="' + L(h) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="36000" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="' + (b.center ? 'ctr' : 'l') + '"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr>' + runs + '</a:p></p:txBody></p:sp>';
        } else if (b.kind === 'table') {
          const ncol = b.edges.length, tw0 = b.x1 - b.x0, widths = b.edges.map(e => Math.max(10, e[1] - e[0] + 8)), tot = widths.reduce((a, c) => a + c, 0);
          const rowH = Math.max(10, (b.bottom - b.top) / b.rows.length);
          const grid = widths.map(w => '<a:gridCol w="' + L(w / tot * (tw0 + 8)) + '"/>').join('');
          const rows = b.rows.map(r => '<a:tr h="' + L(rowH) + '">' + r.map(c => '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="' + (C._num(c.text) && c.text.length < 24 ? 'r' : 'l') + '"/>' + (c.text ? '<a:r><a:rPr lang="en-US" sz="' + Math.round(clamp(b.size * sc, 4, 200) * 100) + '"' + (c.bold ? ' b="1"' : '') + ' dirty="0"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr><a:t>' + esc(c.text) + '</a:t></a:r>' : '<a:endParaRPr lang="en-US" sz="1000"/>') + '</a:p></a:txBody><a:tcPr marL="36000" marR="36000" marT="9000" marB="9000"><a:lnL w="6350"><a:solidFill><a:srgbClr val="999999"/></a:solidFill></a:lnL><a:lnR w="6350"><a:solidFill><a:srgbClr val="999999"/></a:solidFill></a:lnR><a:lnT w="6350"><a:solidFill><a:srgbClr val="999999"/></a:solidFill></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="999999"/></a:solidFill></a:lnB></a:tcPr></a:tc>').join('') + '</a:tr>').join('');
          shapes += '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + (sid++) + '" name="Table ' + sid + '"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="' + X(b.x0 - 4) + '" y="' + Y(b.top) + '"/><a:ext cx="' + L(tw0 + 8) + '" cy="' + L(rowH * b.rows.length) + '"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>' + grid + '</a:tblGrid>' + rows + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
        }
      });
      slides.push({ xml: XML + '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>', rels: srels });
    });
    if (!slides.length) slides.push({ xml: XML + '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>', rels: [] });
    const NSA = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const files = {};
    files['[Content_Types].xml'] = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      + slides.map((s, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    files['_rels/.rels'] = rels([['rId1', RT + 'officeDocument', 'ppt/presentation.xml'], REL_CORE]);
    files['docProps/core.xml'] = core(o.title);
    files['ppt/presentation.xml'] = XML + '<p:presentation ' + NSA + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + slides.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="' + emu(SW) + '" cy="' + emu(SH) + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
    files['ppt/_rels/presentation.xml.rels'] = rels([['rId1', RT + 'slideMaster', 'slideMasters/slideMaster1.xml']].concat(slides.map((s, i) => ['rId' + (i + 2), RT + 'slide', 'slides/slide' + (i + 1) + '.xml'])));
    slides.forEach((s, i) => {
      files['ppt/slides/slide' + (i + 1) + '.xml'] = s.xml;
      files['ppt/slides/_rels/slide' + (i + 1) + '.xml.rels'] = rels([['rId1', RT + 'slideLayout', '../slideLayouts/slideLayout1.xml']].concat(s.rels));
    });
    files['ppt/slideMasters/slideMaster1.xml'] = XML + '<p:sldMaster ' + NSA + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>';
    files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([['rId1', RT + 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', RT + 'theme', '../theme/theme1.xml']]);
    files['ppt/slideLayouts/slideLayout1.xml'] = XML + '<p:sldLayout ' + NSA + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
    files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([['rId1', RT + 'slideMaster', '../slideMasters/slideMaster1.xml']]);
    files['ppt/theme/theme1.xml'] = XML + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Patram"><a:themeElements><a:clrScheme name="Patram"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="DC2626"/></a:accent2><a:accent3><a:srgbClr val="16A34A"/></a:accent3><a:accent4><a:srgbClr val="D97706"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Patram"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Patram"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
    Object.assign(files, media);
    return zip(files);
  };
})(window.PaperLab);
