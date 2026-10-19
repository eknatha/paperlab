/* PaperLab — OCR engine (Tesseract.js, fully local).
   All assets live in vendor/tesseract/ — nothing is fetched from a CDN.
   One shared scheduler (a pool of Tesseract workers) serves every page of every file in flight,
   so Mass Batch gets page-level parallelism for free. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const OCR = PL.ocr = PL.ocr || {};

  /* Languages shipped in vendor/tesseract/lang/*.traineddata.gz.
     `script` = key of the Unicode font used for the invisible text layer (see searchable.js).
     Other Devanagari-script languages (Konkani, Maithili, Dogri, Bodo, Sanskrit…) work well with Hindi/Marathi. */
  OCR.LANGS = [
    { id: 'eng', label: 'English',                 script: null },
    { id: 'hin', label: 'Hindi · हिन्दी',            script: 'dev' },
    { id: 'ben', label: 'Bengali · বাংলা',           script: 'ben' },
    { id: 'tel', label: 'Telugu · తెలుగు',           script: 'tel' },
    { id: 'mar', label: 'Marathi · मराठी',           script: 'dev' },
    { id: 'tam', label: 'Tamil · தமிழ்',            script: 'tam' },
    { id: 'urd', label: 'Urdu · اردو',              script: 'ara' },
    { id: 'guj', label: 'Gujarati · ગુજરાતી',        script: 'guj' },
    { id: 'kan', label: 'Kannada · ಕನ್ನಡ',           script: 'kan' },
    { id: 'mal', label: 'Malayalam · മലയാളം',        script: 'mal' },
    { id: 'ori', label: 'Odia · ଓଡ଼ିଆ',              script: 'ori' },
    { id: 'pan', label: 'Punjabi · ਪੰਜਾਬੀ',           script: 'gur' },
    { id: 'asm', label: 'Assamese · অসমীয়া',        script: 'ben', tess: 'ben' },   // upstream asm model returns nothing; the Bengali–Assamese script model reads it correctly
    { id: 'nep', label: 'Nepali · नेपाली',           script: 'dev' }
  ];

  /* ui options → tesseract language string, e.g. {lang:'tel', eng:true} → 'tel+eng' */
  OCR.langId = function (o) {
    const l = (o && o.lang) || 'eng';
    const e = OCR.LANGS.find(x => x.id === l) || OCR.LANGS[0];
    const t = e.tess || e.id;
    const withEng = !o || o.eng === undefined || o.eng === true || o.eng === 'true';
    return t !== 'eng' && withEng ? t + '+eng' : t;
  };

  const BASE = () => new URL('vendor/tesseract/', document.baseURI).href;

  let eng = null;            // { key, scheduler, workers, n, ready:Promise }
  let statusCb = null;

  OCR.defaultWorkers = function () {
    const e = PL.env;
    if (e.mobile) return e.mem <= 3 ? 1 : 2;
    return Math.max(1, Math.min(4, e.cores - 1));
  };

  /* Get (or build) the worker pool for a language set. Re-uses the pool when the key matches. */
  OCR.acquire = async function (lang, n, onStatus) {
    n = n || OCR.defaultWorkers();
    statusCb = onStatus || null;
    if (eng && eng.key === lang + '|' + n && !eng.dead) return eng.ready;
    await OCR.shutdown();
    await PL.loadScript('vendor/tesseract/tesseract.min.js');
    const key = lang + '|' + n;
    const cur = eng = { key, n, workers: [], scheduler: null, dead: false };
    cur.ready = (async () => {
      const base = BASE();
      const scheduler = Tesseract.createScheduler();
      cur.scheduler = scheduler;
      if (statusCb) statusCb('Loading OCR engine…');
      // Create the first worker alone so the 4 MB core + language data hit the HTTP cache once,
      // then spin up the rest in parallel.
      const mk = () => Tesseract.createWorker(lang, 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core',
        langPath: base + 'lang',
        gzip: true,
        cacheMethod: 'none',         // files are already local; skip IndexedDB copies
        workerBlobURL: true
      });
      const first = await mk();
      if (cur.dead) { await first.terminate(); throw abortErr(); }
      cur.workers.push(first); scheduler.addWorker(first);
      const rest = await Promise.all(Array.from({ length: n - 1 }, mk));
      rest.forEach(w => { cur.workers.push(w); scheduler.addWorker(w); });
      if (cur.dead) { await OCR.shutdown(); throw abortErr(); }
      return cur;
    })();
    return cur.ready;
  };

  function abortErr() { const e = new Error('Cancelled'); e.name = 'AbortError'; return e; }

  OCR.shutdown = async function () {
    const cur = eng; eng = null;
    if (!cur) return;
    cur.dead = true;
    try { if (cur.scheduler) await cur.scheduler.terminate(); } catch (e) { /* ignore */ }
    for (const w of cur.workers) { try { await w.terminate(); } catch (e) { /* ignore */ } }
  };

  /* Recognize one canvas/blob → { words:[…], lines:[…], text, confidence } in image pixel space. */
  OCR.recognize = async function (image, ctx) {
    if (!eng) throw new Error('OCR engine is not running');
    const cur = eng;
    await cur.ready;
    if (cur.dead) throw abortErr();
    let res;
    try {
      res = await cur.scheduler.addJob('recognize', image, { rotateAuto: false },
        { text: true, blocks: true, hocr: false, tsv: false });
    } catch (e) {
      if (cur.dead || (ctx && ctx.signal && ctx.signal.aborted)) throw abortErr();
      throw e;
    }
    const d = res.data, lines = [];
    (d.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => {
      const words = (l.words || []).filter(w => w.text && w.text.trim());
      if (words.length) lines.push({ words, bbox: l.bbox, baseline: l.baseline });
    })));
    return { lines, text: (d.text || '').trim(), confidence: d.confidence };
  };
})(window.PaperLab);
