# PaperLab

Offline PDF toolkit — part of the [EknathaLabs](https://eknathalabs.com) ecosystem.

**No uploads. No backend. Every operation runs entirely in your browser.**

Live: [paperlab.eknathalabs.com](https://paperlab.eknathalabs.com)

## Architecture

Multi-file vanilla HTML/CSS/JS — no build step, no framework. `index.html` is a thin
shell that loads shared core + one self-registering module per tool.

```
paperlab/
├── index.html              # shell: markup + script tags only
├── css/
│   └── styles.css          # all styling
├── js/
│   ├── helpers.js          # PaperLab namespace + shared utils (el, dropZone, download…)
│   ├── registry.js         # tool metadata (id, icon, title, group)
│   ├── app.js              # grid render + workspace modal + boot
│   └── tools/              # one file per tool, each calls PaperLab.register(id, fn)
│       ├── merge.js
│       ├── split.js
│       ├── organize.js
│       ├── rotate.js
│       ├── img2pdf.js
│       ├── pdf2img.js
│       ├── compress.js
│       ├── watermark.js
│       ├── numbers.js
│       ├── extract.js
│       └── meta.js
├── vendor/                 # (optional) drop pdf-lib + pdf.js here for zero-network
├── CNAME
└── .nojekyll
```

### Adding a tool

1. Create `js/tools/<id>.js`:
   ```js
   (function (PL) {
     PL.register('<id>', function (root) { /* build UI into root */ });
   })(window.PaperLab);
   ```
2. Add a metadata entry to `js/registry.js`.
3. Add a `<script src="js/tools/<id>.js">` line in `index.html`.

## Tools

| Group | Tool | Engine |
|---|---|---|
| Page ops | Merge, Split, Organize, Rotate all | `pdf-lib` + `pdf.js` |
| Convert | Images → PDF, PDF → Images, **PDF → Word / Excel / PowerPoint**, **Scan to PDF (camera or photos)**, **E-books & comics (EPUB ⇄ PDF, CBZ ⇄ PDF)** | `pdf-lib` / `pdf.js` / `fflate` |
| Optimize & mark | **Compress to target (100 KB / 200 KB / 300 KB / 1 MB / custom / manual)**, **Watermark (visible, invisible tracking mark, per-recipient copies, mark checker)**, Page numbers / Bates | `pdf-lib` + `pdf.js` |
| Read & inspect | Extract text, Metadata | `pdf.js` / `pdf-lib` |
| Security | **Password-protect (AES-256, print/copy/edit limits) and Unlock** (with the password you supply) | `qpdf` → WebAssembly (vendored, ISC) |
| Power tools | **Searchable (OCR → searchable PDF)**, **Mass Batch**, **Compare PDFs**, **Repair PDF** | Tesseract.js, `fflate`, `pdf.js` |

### Searchable (OCR)
Renders each page, recognises it with Tesseract (offline, bundled language data) and overlays an *invisible* text layer, so the PDF looks identical but is selectable/searchable.
Languages: English, Hindi, Bengali, Telugu, Marathi, Tamil, Urdu, Gujarati, Kannada, Malayalam, Odia, Punjabi, Assamese (Bengali-script model), Nepali.
Fonts (Noto, `vendor/fonts/`) are embedded through `@pdf-lib/fontkit` with 1:1 glyph mapping (no shaping) so extracted text keeps its logical order.

### Mass Batch
Any single-file tool (watermark, compress, rotate, strip, text, searchable…) over hundreds of files/folders, plus merge. Bounded concurrency and memory, per-file failure isolation, pause / resume / cancel / retry, ZIP (auto-split) or direct-to-folder output (desktop Chromium), CSV report.

### Compress to target
Re-encodes embedded images first (text stays selectable); flattens pages only if needed and allowed. If a target cannot be reached it says so instead of claiming success.

### Compare PDFs
Word-level diff (Myers) plus a shift-tolerant pixel diff; differences / side-by-side / swipe views; HTML report. Scans without a text layer: run Searchable first.

### Repair PDF
Ladder, stopping at the first rung that passes verification: (1) pdf-lib re-save; (2) raw-byte scan for every `N G obj … endobj`, unpack object streams, drop broken objects, find or synthesise the catalog / page tree, write a clean file; (3) page-by-page salvage; (4) optionally redraw readable pages as images. Every Flate stream is checked; undecodable ones are blanked and the page is reported as blank/damaged, so the page count reported is the number of pages that really have content. Encrypted files are refused.

### Watermark: visible, invisible, both
Visible text (tiled or diagonal), an **invisible tracking mark** (document-information entry + zero-opacity text on every page, with a checksum), one **marked copy per recipient** (ZIP + `recipients.csv`), and a **Check a file** tab that reads the mark back. Marks do not survive printing / rasterising; the UI and policy say so.

### PDF → Word, Excel, PowerPoint
Layout analysis (columns, headings, tables, pictures, repeated headers/footers) in `js/convert/layout.js`; hand-built OOXML writers in `js/convert/ooxml.js`. Optional OCR for scanned pages. Also available in Mass Batch (group *Office*). Two-column or skewed scans can mix columns; right-to-left text is not handled; vector charts stay as a picture behind the text in PowerPoint.

### Scan to PDF
Camera (`getUserMedia`, needs HTTPS) or photo import; auto edge detection, draggable corners, perspective correction, Enhanced / Grayscale / B&W filters, rotate, reorder, optional OCR. Nothing leaves the device.

### Password protect / unlock
Uses QPDF compiled to WebAssembly. Unlock needs the password you supply — there is no cracking. A forgotten password cannot be recovered.

### Visitor counter
`js/visitors.js` uses Abacus with CountAPI-clone fallback (counterapi.dev v1 was shut down on 7 Aug 2026). Set `BASELINE` to continue from your old total.

### E-books & comics
`EPUB → PDF` (own typesetter: selectable text, headings, lists, tables, images, bookmarks, page numbers; Latin via Noto Serif, Indian scripts via the bundled Noto fonts), `CBZ → PDF` (JPEGs embedded untouched, natural page order), `PDF → EPUB 3` (reflowable text or fixed-layout page images; validated with epubcheck), `PDF → CBZ` (with ComicInfo.xml). DRM-protected EPUBs are refused; CBR/RAR is not supported; right-to-left text is not laid out yet.

### Responsible use
Every tool opens with a short caution, the footer links to `responsible-use.html`, and first-time visitors get a dismissible notice (stored in `localStorage` only).

> **Font note.** fontkit writes a short `loca` table but copies odd-length glyph records unpadded, which corrupts later glyphs (Telugu lost most of its letters). All bundled fonts in `vendor/fonts/` are therefore re-saved with 4-byte-aligned glyph records. If you replace a font, repeat that (`fontTools`: `font['glyf'].padding = 4`).

## Tests
Verified with Playwright (desktop 1366×820 and iPhone-sized emulation), poppler and qpdf: all tools open without errors; OCR round-trip text similarity 1.00 for all 14 languages; compress hits each target; batch tested with nested folders, corrupt/empty/encrypted inputs, natural-order merge, pause/cancel/continue and a 200-file run; compare counts exact; repair tested on truncated, wrong-xref, no-trailer, junk-prefix, object-stream, damaged-dictionary, zeroed-stream, headerless and no-catalog files; EPUB output passes epubcheck 5.3; CBZ page order verified.

## Known limits (honest)

- Very small targets (e.g. 100 KB) on long vector/text PDFs may only be reachable by flattening pages; the tool reports when a target is not reachable.
- OCR quality depends on scan quality; noisy photos may be skipped. First use downloads nothing (data is bundled), but the repo is ~32 MB.
- PDF → Word/Excel/PPT is best-effort layout reconstruction, not pixel-perfect; true (destructive) redaction is out of scope.

## Deploy (GitHub Pages)

1. Push to the `paperlab` repo.
2. Settings → Pages → deploy from `main` / root.
3. DNS: add CNAME record `paperlab` → `eknatha.github.io`.
4. The `CNAME` file binds the custom domain; `.nojekyll` keeps Pages from filtering paths.
