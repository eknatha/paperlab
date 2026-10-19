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
| Convert | Images → PDF, PDF → Images | `pdf-lib` / `pdf.js` |
| Optimize & mark | **Compress to target (100 KB / 200 KB / 300 KB / 1 MB / custom / manual)**, Watermark, Page numbers / Bates | `pdf-lib` + `pdf.js` |
| Read & inspect | Extract text, Metadata | `pdf.js` / `pdf-lib` |
| Power tools | **Searchable (OCR → searchable PDF)**, **Mass Batch**, **Compare PDFs** | Tesseract.js, `fflate`, `pdf.js` |

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

## Tests
Verified with Playwright (desktop 1366×820 and iPhone-sized emulation), poppler and qpdf: all tools open without errors; OCR round-trip text similarity 1.00 for all 14 languages; compress hits each target; batch tested with nested folders, corrupt/empty/encrypted inputs, natural-order merge, pause/cancel/continue and a 200-file run; compare counts exact.

## Known limits (honest)

- Very small targets (e.g. 100 KB) on long vector/text PDFs may only be reachable by flattening pages; the tool reports when a target is not reachable.
- OCR quality depends on scan quality; noisy photos may be skipped. First use downloads nothing (data is bundled), but the repo is ~32 MB.
- Password-protected PDFs are reported as failed (encryption/decryption is not available in-browser yet).
- High-fidelity PDF → Word/Excel and true (destructive) redaction are out of scope.

## Deploy (GitHub Pages)

1. Push to the `paperlab` repo.
2. Settings → Pages → deploy from `main` / root.
3. DNS: add CNAME record `paperlab` → `eknatha.github.io`.
4. The `CNAME` file binds the custom domain; `.nojekyll` keeps Pages from filtering paths.
