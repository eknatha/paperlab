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

## Tools (Phase 1)

| Group | Tool | Engine |
|---|---|---|
| Page ops | Merge, Split, Organize (reorder/delete/duplicate/rotate), Rotate all | `pdf-lib` + `pdf.js` |
| Convert | Images → PDF, PDF → Images | `pdf-lib` / `pdf.js` |
| Optimize & mark | Compress, Watermark, Page numbers / Bates | `pdf-lib` + `pdf.js` |
| Read & inspect | Extract text, Metadata view/edit/strip | `pdf.js` / `pdf-lib` |

## Coming (lazy-loaded WASM modules)

- **Password & permissions** — encrypt / decrypt (needs `qpdf.wasm` or `mupdf.wasm`; `pdf-lib` can't write encryption)
- **OCR scanned PDFs** — `Tesseract.js`

## Engines

`pdf-lib` and `pdf.js` load from CDN by default. For **true zero-network**, download both
into `vendor/` and repoint the two `<script>` tags in `index.html`.

## Known limits (honest)

- **Compress** rasterizes pages to JPEG — text becomes non-selectable. Best for image-heavy/scanned PDFs.
- **Extract text** works on text-based PDFs only; scanned PDFs need OCR.
- High-fidelity PDF → Word/Excel and true (destructive) redaction are out of scope in-browser.

## Deploy (GitHub Pages)

1. Push to the `paperlab` repo.
2. Settings → Pages → deploy from `main` / root.
3. DNS: add CNAME record `paperlab` → `eknatha.github.io`.
4. The `CNAME` file binds the custom domain; `.nojekyll` keeps Pages from filtering paths.
