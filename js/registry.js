/* PaperLab — tool registry (metadata only; builders live in js/tools/*.js) */
window.PaperLab = window.PaperLab || { tools: {} };

window.PaperLab.registry = [
  { g: 'Page operations' },
  { id: 'merge',    ico: '⊞', t: 'Merge',        d: 'Combine multiple PDFs into one, in your chosen order.' },
  { id: 'split',    ico: '⊟', t: 'Split',        d: 'Extract page ranges into separate PDF files.' },
  { id: 'organize', ico: '⇅', t: 'Organize',     d: 'Reorder, delete, duplicate & rotate pages visually.' },
  { id: 'rotate',   ico: '⟳', t: 'Rotate',       d: 'Turn all pages 90 / 180 / 270 degrees.' },

  { g: 'Convert' },
  { id: 'img2pdf',  ico: '▤', t: 'Images → PDF', d: 'Build a PDF from JPEG / PNG / WebP images.' },
  { id: 'pdf2img',  ico: '▥', t: 'PDF → Images', d: 'Export each page as a PNG or JPEG.' },

  { g: 'Optimize & mark' },
  { id: 'compress', ico: '⤓', t: 'Compress',     d: 'Re-encode images to shrink file size.' },
  { id: 'watermark',ico: '※', t: 'Watermark',    d: 'Stamp text across every page, tiled or single.' },
  { id: 'numbers',  ico: '#', t: 'Page numbers', d: 'Add page numbers or Bates-style stamps.' },

  { g: 'Read & inspect' },
  { id: 'extract',  ico: '¶', t: 'Extract text', d: 'Pull selectable text out of a PDF.' },
  { id: 'meta',     ico: 'ⓘ', t: 'Metadata',     d: 'View, edit, or strip document metadata.' },

  { g: 'Heavier — loads on demand' },
  { id: 'secure',   ico: '⚿', t: 'Password & permissions', d: 'Encrypt / decrypt. Needs qpdf.wasm module.', soon: true },
  { id: 'ocr',      ico: '⊙', t: 'OCR scanned PDF',        d: 'Make scans searchable. Needs Tesseract.js.', soon: true }
];
