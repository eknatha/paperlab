/* PaperLab — tool registry (metadata only; builders in js/tools/*.js)
   primary:true → oversized primary cards; g:'...' → secondary group; soon:true → disabled */
window.PaperLab = window.PaperLab || { tools: {} };

window.PaperLab.registry = [
  // ----- primary (oversized) -----
  { id: 'merge',    ico: '⊞', t: 'Merge',    d: 'Combine multiple PDFs into one, in your order.', primary: true },
  { id: 'split',    ico: '⊟', t: 'Split',    d: 'Extract page ranges into separate files.',       primary: true },
  { id: 'compress', ico: '⤓', t: 'Compress', d: 'Shrink a PDF to 100 KB, 200 KB, 300 KB, 1 MB or any size you choose.', primary: true },

  // ----- secondary groups -----
  { g: 'Power tools' },
  { id: 'searchable', ico: '⌕', t: 'Searchable (OCR)', d: 'Scanned PDFs & photos → searchable PDF. Hindi, Telugu, Tamil, Bengali + 10 more languages.' },
  { id: 'batch',      ico: '⧉', t: 'Mass Batch',       d: 'Compress, OCR, watermark or merge hundreds of files at once. No limits.' },
  { id: 'compare',    ico: '⇋', t: 'Compare PDFs',     d: 'See exactly what changed — words and pixels — between two versions.' },
  { id: 'repair',     ico: '✚', t: 'Repair PDF',       d: 'Fix files that will not open: broken index, cut-off download, damaged pages. Keeps every page it can read.' },

  { g: 'Pages' },
  { id: 'organize', ico: '⇅', t: 'Organize',     d: 'Reorder, delete, duplicate & rotate pages visually.' },
  { id: 'rotate',   ico: '⟳', t: 'Rotate',       d: 'Turn all pages 90 / 180 / 270 degrees.' },
  { id: 'numbers',  ico: '#', t: 'Page numbers', d: 'Add page numbers or Bates-style stamps.' },

  { g: 'Convert' },
  { id: 'img2pdf',  ico: '▤', t: 'Images → PDF', d: 'Build a PDF from JPEG / PNG / WebP images.' },
  { id: 'pdf2img',  ico: '▥', t: 'PDF → Images', d: 'Export each page as a PNG or JPEG.' },
  { id: 'scan',    ico: '◫', t: 'Scan to PDF', d: 'Use your camera or photos: finds the page edges, straightens it, cleans it up like a scanner. Optional OCR.' },
  { id: 'office',   ico: '▦', t: 'PDF → Word, Excel, PPT', d: 'Editable .docx, .xlsx and .pptx with columns, headings, tables and pictures. Optional OCR for scans.' },
  { id: 'books',    ico: '❡', t: 'E-books & comics', d: 'EPUB ⇄ PDF and CBZ ⇄ PDF. Keeps text selectable, adds bookmarks. DRM-free files only.' },

  { g: 'Security' },
  { id: 'secure',    ico: '🔒︎', t: 'Protect & unlock', d: 'Add a password (AES-256) with print / copy / edit limits — or remove a password you know. Never cracks passwords.' },

  { g: 'Mark & inspect' },
  { id: 'watermark', ico: '※', t: 'Watermark',     d: 'Visible text across every page, or an invisible per-recipient tracking mark — plus a checker to read it back.' },
  { id: 'extract',   ico: '¶', t: 'Extract text',  d: 'Pull selectable text out of a PDF.' },
  { id: 'meta',      ico: 'ⓘ', t: 'Metadata',      d: 'View, edit, or strip document metadata.' }
];
