/* PaperLab — shared PDF operations.
   Single-file tools AND Mass Batch both call these, so behaviour never drifts.

   op = {
     id, label, group, accepts: ['pdf'] | ['pdf','image'],
     suffix, ext, fields: [...],                // UI descriptors for Mass Batch
     run(bytes: Uint8Array, opts, ctx) → { bytes, ext?, extras?, note?, skipped? }
   }
   ctx = { progress(frac, msg), signal, name }

   Rules: ops never keep or mutate the caller's buffer, always destroy pdf.js docs,
   and zero out canvases (iOS Safari has a hard canvas-memory ceiling). */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const ops = PL.ops = {};
  const noop = () => {};

  function abortIf(ctx) {
    if (ctx && ctx.signal && ctx.signal.aborted) {
      const e = new Error('Cancelled'); e.name = 'AbortError'; throw e;
    }
  }
  PL.abortIf = abortIf;

  // pdf.js transfers the buffer it is given, so always hand it a copy
  PL.openPdfjs = function (bytes) {
    return pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  };

  PL.freeCanvas = function (cv) { try { cv.width = 0; cv.height = 0; } catch (e) { /* ignore */ } };

  PL.canvasToBlob = function (cv, type, q) {
    return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Canvas export failed (page too large for this device?)')), type, q));
  };

  /* Render a pdf.js page to a canvas, clamping the pixel count to the device limit. */
  PL.renderPage = async function (page, scale, maxPx) {
    maxPx = maxPx || PL.env.maxCanvasPx;
    let vp = page.getViewport({ scale });
    const px = vp.width * vp.height;
    if (px > maxPx) { scale *= Math.sqrt(maxPx / px); vp = page.getViewport({ scale }); }
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.floor(vp.width)); cv.height = Math.max(1, Math.floor(vp.height));
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return { cv, vp };
  };

  /* ───────────── rotate ───────────── */
  ops.rotate = {
    id: 'rotate', label: 'Rotate all pages', group: 'Pages', accepts: ['pdf'], suffix: '-rotated', ext: 'pdf',
    fields: [{ id: 'deg', label: 'Rotate by', type: 'select', value: '90',
      options: [['90', '90° clockwise'], ['180', '180°'], ['270', '270° (90° CCW)']] }],
    async run(bytes, o, ctx) {
      const { PDFDocument, degrees } = PL.lib();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: !!o.lenient });
      const d = +o.deg || 90;
      doc.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + d) % 360)));
      return { bytes: await doc.save() };
    }
  };

  /* ───────────── watermark (visible, invisible tracking mark, or both) ───────────── */
  ops.watermark = {
    id: 'watermark', label: 'Watermark', group: 'Mark', accepts: ['pdf'], suffix: '-watermarked', ext: 'pdf',
    fields: [
      { id: 'mode', label: 'Type', type: 'select', value: 'visible', options: [['visible', 'Visible text'], ['invisible', 'Invisible tracking mark'], ['both', 'Visible + invisible']] },
      { id: 'txt', label: 'Text', type: 'text', value: 'CONFIDENTIAL', showNotIf: ['mode', 'invisible'] },
      { id: 'op', label: 'Opacity', type: 'select', value: '0.15', options: [['0.15', 'Subtle'], ['0.3', 'Medium'], ['0.5', 'Strong']], showNotIf: ['mode', 'invisible'] },
      { id: 'ly', label: 'Layout', type: 'select', value: 'diag', options: [['diag', 'Diagonal'], ['tile', 'Tiled']], showNotIf: ['mode', 'invisible'] },
      { id: 'sz', label: 'Size', type: 'select', value: '48', options: [['48', 'Medium'], ['72', 'Large'], ['32', 'Small']], showNotIf: ['mode', 'invisible'] },
      { id: 'tag', label: 'Invisible tag (recipient / ID — blank = file name)', type: 'text', value: '', showNotIf: ['mode', 'visible'] }
    ],
    async run(bytes, o, ctx) {
      const { PDFDocument, degrees, rgb, StandardFonts } = PL.lib();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: !!o.lenient });
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const mode = o.mode || 'visible', vis = mode !== 'invisible', inv = mode !== 'visible';
      if (vis) {
        // Helvetica can only encode WinAnsi; drop anything else instead of crashing the file
        const ok = new Set(font.getCharacterSet());
        const txt = Array.from(o.txt || 'WATERMARK').filter(c => ok.has(c.codePointAt(0))).join('') || 'WATERMARK';
        const op = +o.op || 0.15, sz = +o.sz || 48, ly = o.ly || 'diag';
        doc.getPages().forEach(p => {
          const { width: w, height: h } = p.getSize();
          const opts = { size: sz, font, color: rgb(.5, .5, .5), opacity: op };
          if (ly === 'diag') {
            p.drawText(txt, { ...opts, x: w * 0.12, y: h * 0.45, rotate: degrees(35) });
          } else {
            const tw = font.widthOfTextAtSize(txt, sz) + 40, th = sz + 50;
            for (let y = 20; y < h; y += th) for (let x = -20; x < w; x += tw) p.drawText(txt, { ...opts, x, y, rotate: degrees(20) });
          }
        });
      }
      let tag = '';
      if (inv) {
        tag = String(o.tag || '').trim() || String((ctx && ctx.name) || 'document').replace(/\.pdf$/i, '');
        PL.mark.apply(doc, font, tag);
      }
      return { bytes: await doc.save(), tag, note: inv ? 'invisible tag “' + tag + '”' : undefined };
    }
  };

  /* ───────────── page numbers / Bates ───────────── */
  ops.numbers = {
    id: 'numbers', label: 'Page numbers / Bates', group: 'Pages', accepts: ['pdf'], suffix: '-numbered', ext: 'pdf',
    fields: [
      { id: 'fmt', label: 'Format', type: 'select', value: 'n', options: [['n', '1, 2, 3…'], ['np', 'Page 1'], ['not', '1 / N']] },
      { id: 'pos', label: 'Position', type: 'select', value: 'bc', options: [['bc', 'Bottom center'], ['br', 'Bottom right'], ['bl', 'Bottom left']] },
      { id: 'start', label: 'Start at', type: 'number', value: '1', min: 1 },
      { id: 'pre', label: 'Prefix (Bates)', type: 'text', value: '' }
    ],
    async run(bytes, o, ctx) {
      const { PDFDocument, rgb, StandardFonts } = PL.lib();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: !!o.lenient });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const ok = new Set(font.getCharacterSet());
      const pre = Array.from(o.pre || '').filter(c => ok.has(c.codePointAt(0))).join('');
      const fmt = o.fmt || 'n', pos = o.pos || 'bc', start = +o.start || 1;
      const pages = doc.getPages(), N = pages.length;
      pages.forEach((p, i) => {
        const num = start + i; let label;
        if (fmt === 'np') label = 'Page ' + num;
        else if (fmt === 'not') label = num + ' / ' + (start + N - 1);
        else label = '' + num;
        if (pre) label = pre + label;
        const { width: w } = p.getSize(); const sz = 10; const tw = font.widthOfTextAtSize(label, sz);
        let x; if (pos === 'bc') x = (w - tw) / 2; else if (pos === 'br') x = w - tw - 36; else x = 36;
        p.drawText(label, { x, y: 24, size: sz, font, color: rgb(.3, .3, .3) });
      });
      return { bytes: await doc.save(), note: N + ' pages' };
    }
  };

  /* ───────────── strip metadata ───────────── */
  ops.strip = {
    id: 'strip', label: 'Strip metadata', group: 'Mark', accepts: ['pdf'], suffix: '-clean', ext: 'pdf',
    fields: [],
    async run(bytes, o, ctx) {
      const { PDFDocument, PDFName } = PL.lib();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: !!o.lenient, updateMetadata: false });
      const info = doc.getInfoDict();
      ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']
        .forEach(k => info.delete(PDFName.of(k)));
      doc.catalog.delete(PDFName.of('Metadata'));            // XMP packet
      return { bytes: await doc.save({ updateFieldAppearances: false }) };
    }
  };

  /* ───────────── extract text → .txt ───────────── */
  ops.text = {
    id: 'text', label: 'Extract text (.txt)', group: 'Read', accepts: ['pdf'], suffix: '', ext: 'txt',
    fields: [],
    async run(bytes, o, ctx) {
      ctx = ctx || {};
      const pdf = await PL.openPdfjs(bytes);
      try {
        const parts = []; let chars = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
          abortIf(ctx);
          (ctx.progress || noop)((i - 1) / pdf.numPages, 'page ' + i + '/' + pdf.numPages);
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          let line = '', out = '';
          tc.items.forEach(it => { out += it.str; out += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : ''); });
          out = out.replace(/[ \t]+\n/g, '\n').trim();
          chars += out.length;
          parts.push('— Page ' + i + ' —\n' + out);
          page.cleanup();
        }
        const txt = parts.join('\n\n');
        return { bytes: new TextEncoder().encode(txt), ext: 'txt', note: chars ? undefined : 'no text layer — use Searchable (OCR) first' };
      } finally { pdf.destroy(); }
    }
  };

  /* ───────────── merge (many → one) ───────────── */
  ops.merge = {
    id: 'merge', label: 'Merge into one PDF', group: 'Pages', accepts: ['pdf'], kind: 'group', suffix: '', ext: 'pdf',
    fields: [
      { id: 'per', label: 'Files per merged PDF', type: 'select', value: '0',
        options: [['0', 'All files → one PDF'], ['2', 'Groups of 2'], ['5', 'Groups of 5'], ['10', 'Groups of 10'], ['25', 'Groups of 25'], ['50', 'Groups of 50']] },
      { id: 'sort', label: 'Order', type: 'select', value: 'nat', options: [['nat', 'Natural (file2 before file10)'], ['none', 'As added']] }
    ],
    /* files: [{file, path}] already ordered. Loads one source at a time to keep memory flat.
       A damaged / encrypted member is reported via ctx.onBad and skipped; the rest still merge. */
    async runGroup(files, o, ctx) {
      const { PDFDocument } = PL.lib();
      const merged = await PDFDocument.create();
      let used = 0;
      for (let i = 0; i < files.length; i++) {
        abortIf(ctx);
        (ctx.progress || noop)(i / files.length, files[i].file.name);
        try {
          const buf = new Uint8Array(await files[i].file.arrayBuffer());
          const src = await PDFDocument.load(buf, { ignoreEncryption: false });
          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach(p => merged.addPage(p));
          used++;
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          if (ctx.onBad) ctx.onBad(files[i], e); else throw e;
        }
        await PL.tick();
      }
      if (!used) throw new Error('No valid PDFs in this group');
      return { bytes: await merged.save(), note: used + ' files → ' + merged.getPageCount() + ' pages' };
    }
  };
})(window.PaperLab);
