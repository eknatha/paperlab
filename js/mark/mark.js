/* PaperLab — invisible document marks (for tracing YOUR OWN documents to the person you sent them to).

   A mark is written on two channels so one survives when the other is stripped:
     1. a custom document-information entry   /PaperLabMark  (survives copy, rename, most re-saves)
     2. hidden zero-opacity text on every page  "PLMARK1:<tag>:<check>"  (survives metadata stripping; also travels with
        copy-pasted text)
   Honest limits: printing, screenshotting, "print to PDF" or rasterising a page removes the mark. It is a deterrent and a
   lead, not proof. Only mark documents you own or are entitled to distribute, and tell recipients when you do. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const M = PL.mark = {};
  const PREFIX = 'PLMARK1:';

  const enc = tag => encodeURIComponent(tag).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const dec = e => { try { return decodeURIComponent(e); } catch (x) { return e; } };
  function check(s) {                                   // 16-bit FNV-style checksum, 4 hex chars
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ((h ^ (h >>> 16)) & 0xffff).toString(16).padStart(4, '0');
  }
  M.token = tag => { const e = enc(tag); return PREFIX + e + ':' + check(e); };
  M.safeName = tag => tag.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'copy';

  /* write both channels into a pdf-lib document (needs an embedded font for the hidden text) */
  M.apply = function (doc, font, tag) {
    const L = PL.lib(), token = M.token(tag);
    doc.getInfoDict().set(L.PDFName.of('PaperLabMark'), L.PDFHexString.fromText(tag));
    doc.getPages().forEach(p => {
      const { width: w, height: h } = p.getSize();
      p.drawText(token, { x: 2, y: 2, size: 2, font, opacity: 0 });
      p.drawText(token, { x: Math.max(2, w / 2 - 20), y: Math.max(2, h - 6), size: 2, font, opacity: 0 });
    });
    return token;
  };

  /* → { info: tag|null, tags: [{tag, pages}], total, marked, bad } */
  M.detect = async function (bytes, ctx) {
    const pdf = await PL.openPdfjs(bytes);
    try {
      let info = null;
      try {
        const md = await pdf.getMetadata();
        const c = md && md.info && md.info.Custom;
        if (c && c.PaperLabMark) info = String(c.PaperLabMark);
      } catch (e) { /* no metadata */ }
      const found = new Map(); let marked = 0, bad = 0;
      const re = /PLMARK1:([A-Za-z0-9%._~-]+):([0-9a-f]{4})/g;
      for (let i = 1; i <= pdf.numPages; i++) {
        PL.abortIf(ctx);
        const pg = await pdf.getPage(i), tc = await pg.getTextContent();
        const text = tc.items.map(it => it.str).join('');
        const seen = new Set(); let m;
        re.lastIndex = 0;
        while ((m = re.exec(text))) {
          if (check(m[1]) !== m[2]) { bad++; continue; }
          seen.add(dec(m[1]));
        }
        seen.forEach(t => found.set(t, (found.get(t) || 0) + 1));
        if (seen.size) marked++;
        pg.cleanup();
        if (i % 10 === 0) await PL.tick();
      }
      return { info, tags: [...found].map(([tag, pages]) => ({ tag, pages })), total: pdf.numPages, marked, bad };
    } finally { pdf.destroy(); }
  };
})(window.PaperLab);
