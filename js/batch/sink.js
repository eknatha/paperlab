/* PaperLab — Mass Batch output sinks.
   ZipSink : streams results into ZIP parts (fflate), split by size so no single archive exhausts memory.
             Works in every browser, including phones.
   DirSink : writes each result straight into a user-chosen folder (File System Access API —
             Chromium desktop). Memory stays flat no matter how many files. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const B = PL.batch = PL.batch || {};

  class BaseSink {
    constructor() { this.used = new Set(); this.count = 0; this.bytes = 0; }
    /* de-duplicate output paths (case-insensitively): a.pdf, a (2).pdf, … */
    uniq(path) {
      path = path.replace(/^\/+/, '').replace(/\\/g, '/');
      let p = path, n = 1;
      const dot = path.lastIndexOf('.'), slash = path.lastIndexOf('/');
      const hasExt = dot > slash + 1;
      const stem = hasExt ? path.slice(0, dot) : path, ext = hasExt ? path.slice(dot) : '';
      while (this.used.has(p.toLowerCase())) p = stem + ' (' + (++n) + ')' + ext;
      this.used.add(p.toLowerCase());
      return p;
    }
  }

  class ZipSink extends BaseSink {
    constructor(opts) {
      super();
      opts = opts || {};
      this.kind = 'zip';
      this.limit = opts.partLimit || (PL.env.mobile ? 80 : 400) * 1048576;
      this.prefix = opts.prefix || 'paperlab-batch';
      this.parts = []; this.zip = null; this.err = null;
    }
    _open() {
      this.chunks = []; this.partBytes = 0; this.partFiles = 0;
      const chunks = this.chunks;
      this.zip = new fflate.Zip((err, chunk, final) => {
        if (err) { this.err = err; return; }
        chunks.push(chunk); this.partBytes += chunk.length;
        if (final) this.parts.push({ blob: new Blob(chunks, { type: 'application/zip' }), files: this.partFiles });
      });
    }
    async add(path, bytes) {
      path = this.uniq(path);
      if (!this.zip) this._open();
      const e = new fflate.ZipPassThrough(path);     // PDFs are already compressed → store, don't re-deflate
      this.zip.add(e);
      e.push(bytes, true);
      if (this.err) throw this.err;
      this.partFiles++; this.count++; this.bytes += bytes.length;
      if (this.partBytes >= this.limit) { this.zip.end(); this.zip = null; }
      return path;
    }
    async finish() {
      if (this.zip) { this.zip.end(); this.zip = null; }
      if (this.err) throw this.err;
      const n = this.parts.length;
      return this.parts.map((p, i) => ({
        name: n === 1 ? this.prefix + '.zip' : this.prefix + '-' + String(i + 1).padStart(3, '0') + '.zip',
        blob: p.blob, size: p.blob.size, files: p.files
      }));
    }
  }

  class DirSink extends BaseSink {
    constructor(rootHandle) { super(); this.kind = 'dir'; this.root = rootHandle; this.dirs = new Map(); }
    async _dir(parts) {
      let h = this.root, key = '';
      for (const seg of parts) {
        key += '/' + seg;
        if (!this.dirs.has(key)) this.dirs.set(key, await h.getDirectoryHandle(seg, { create: true }));
        h = this.dirs.get(key);
      }
      return h;
    }
    async add(path, bytes) {
      path = this.uniq(path);
      const parts = path.split('/'), name = parts.pop();
      const dir = await this._dir(parts);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      try { await w.write(bytes); } finally { await w.close(); }
      this.count++; this.bytes += bytes.length;
      return path;
    }
    async finish() { return []; }
  }

  B.ZipSink = ZipSink;
  B.DirSink = DirSink;
})(window.PaperLab);
