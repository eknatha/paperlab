/* PaperLab tool: Compare PDFs — word-level text diff + visual (pixel) diff, fully local.
   Algorithms: js/compare/diff.js */
(function (PL) {
  const X = () => PL.cmp;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  PL.register('compare', function (root) {
    root.classList.add('cmp');
    const S = { A: null, B: null, running: false, ac: null, mode: 'diff', cur: 0, pages: [], text: null, hunks: [], nPages: 0, cache: null, token: 0 };
    const pageW = 900;                                       // analysis width (px) — identical on every device so results never depend on the phone vs desktop
    const viewW = () => Math.min(PL.env.mobile ? 1000 : 1500, Math.round((root.clientWidth || 700) * (window.devicePixelRatio > 1 ? 1.6 : 1.2)));

    /* ── slots ── */
    const slots = PL.el('div', 'cmp-slots');
    function makeSlot(key, title) {
      const box = PL.el('div', 'slot');
      box.innerHTML = '<div class="slot-h"><b>' + key + '</b> ' + title + '</div>';
      const dz = PL.dropZone(fs => load(key, fs.find(f => /\.pdf$/i.test(f.name)) || fs[0]), '.pdf,application/pdf', false);
      dz.classList.add('slim');
      const meta = PL.el('div', 'slot-m', 'No file yet');
      box.append(dz, meta);
      slots.appendChild(box);
      return meta;
    }
    const metaA = makeSlot('A', 'Original'), metaB = makeSlot('B', 'Revised');
    root.appendChild(slots);

    const opt = PL.el('div', 'ctl');
    opt.innerHTML = '<div class="field check"><input type="checkbox" id="cmp_case"><label for="cmp_case">Ignore upper / lower case</label></div>';
    root.appendChild(opt);

    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Compare'); go.disabled = true;
    const swap = PL.el('button', 'btn ghost', '⇄ Swap A / B'); swap.type = 'button';
    const stop = PL.el('button', 'btn ghost', 'Cancel'); stop.style.display = 'none';
    actions.append(go, swap, stop); root.appendChild(actions);
    const bar = PL.el('div', 'bar'); bar.innerHTML = '<i></i>'; bar.style.display = 'none'; root.appendChild(bar);
    const log = PL.logger(root);

    /* ── results ── */
    const results = PL.el('div', 'cmp-results'); results.style.display = 'none';
    results.innerHTML =
      '<div class="cmp-sum"></div>' +
      '<div class="cmp-nav">' +
        '<button class="btn ghost sm" data-a="prev" type="button" aria-label="Previous page">◀</button>' +
        '<span class="pgno" aria-live="polite"></span>' +
        '<button class="btn ghost sm" data-a="next" type="button" aria-label="Next page">▶</button>' +
        '<button class="btn ghost sm" data-a="chg" type="button">Next change ›</button>' +
        '<span class="chips cmp-modes" role="radiogroup" aria-label="View">' +
          '<button class="chip on" data-m="diff" type="button" role="radio">Differences</button>' +
          '<button class="chip" data-m="side" type="button" role="radio">Side by side</button>' +
          '<button class="chip" data-m="swipe" type="button" role="radio">Swipe</button>' +
        '</span>' +
      '</div>' +
      '<div class="cmp-legend"><i class="lg r"></i> only in A (removed) <i class="lg b"></i> only in B (added) <i class="lg y"></i> changed area</div>' +
      '<div class="cmp-stage" aria-live="polite"></div>' +
      '<div class="pstrip" role="list" aria-label="Pages"></div>' +
      '<details class="hunks" open><summary>Text changes</summary><ul class="hlist"></ul></details>' +
      '<div class="actions"><button class="btn ghost" data-a="report" type="button">Download report (HTML)</button></div><div class="out rep"></div>';
    root.appendChild(results);
    const $r = sel => results.querySelector(sel);
    const repOut = $r('.rep'), sum = $r('.cmp-sum'), stage = $r('.cmp-stage'), strip = $r('.pstrip'), hlist = $r('.hlist'), pgno = $r('.pgno');

    const setBar = f => { bar.style.display = 'block'; bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; };
    function destroyAll() {
      S.token++; if (S.ac) S.ac.abort();
      ['A', 'B'].forEach(k => { if (S[k]) { try { S[k].pdf.destroy(); } catch (e) { /* ignore */ } S[k] = null; } });
      freeCache();
    }
    function freeCache() { if (S.cache) { [S.cache.r.canvas, S.cache.r.A, S.cache.r.B].forEach(c => PL.freeCanvas(c)); S.cache = null; } }
    PL.cleanup = destroyAll;                                           // app.js calls this when the workspace closes

    /* ── loading ── */
    async function load(key, file) {
      if (!file) return;
      const meta = key === 'A' ? metaA : metaB;
      if (S.running) return;
      meta.className = 'slot-m'; meta.textContent = 'Reading ' + file.name + '…';
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (PL.sniff(bytes) !== 'pdf') throw new Error('Not a PDF file');
        const pdf = await PL.openPdfjs(bytes);
        if (S[key]) { try { S[key].pdf.destroy(); } catch (e) { /* ignore */ } }
        S[key] = { file, pdf, name: file.name };
        meta.textContent = file.name + ' · ' + pdf.numPages + ' page' + (pdf.numPages === 1 ? '' : 's') + ' · ' + PL.fmtBytes(file.size);
      } catch (e) {
        S[key] = null; meta.className = 'slot-m err'; meta.textContent = file.name + ': ' + PL.friendlyError(e);
      }
      go.disabled = !(S.A && S.B);
      results.style.display = 'none';
    }
    swap.onclick = () => {
      if (S.running) return;
      const t = S.A; S.A = S.B; S.B = t;
      const m = metaA.textContent, mc = metaA.className; metaA.textContent = metaB.textContent; metaA.className = metaB.className; metaB.textContent = m; metaB.className = mc;
      results.style.display = 'none';
    };

    /* ── compare ── */
    async function render(doc, p, scale) {
      const page = await doc.pdf.getPage(p);
      const r = await PL.renderPage(page, scale, PL.env.maxCanvasPx);
      page.cleanup();
      return r.cv;
    }
    function pageScale(p, width) {
      return Promise.all(['A', 'B'].map(async k => {
        if (p > S[k].pdf.numPages) return 0;
        const pg = await S[k].pdf.getPage(p), w = pg.getViewport({ scale: 1 }).width; pg.cleanup(); return w;
      })).then(ws => width / Math.max(ws[0], ws[1], 1));
    }
    async function pair(p, width, force) {         // → { ca, cb } canvases (null when that doc has no such page)
      const scale = await pageScale(p, width);
      const ca = p <= S.A.pdf.numPages ? await render(S.A, p, scale) : null;
      const cb = p <= S.B.pdf.numPages ? await render(S.B, p, scale) : null;
      return { ca, cb };
    }

    go.onclick = async () => {
      if (!(S.A && S.B) || S.running) return;
      S.running = true; S.ac = new AbortController(); S.token++;
      const tok = S.token;
      go.disabled = swap.disabled = true; stop.style.display = ''; results.style.display = 'none';
      PL.busy = () => S.running;
      const sig = S.ac.signal, t0 = performance.now();
      try {
        log.set('Reading text…'); setBar(0.02);
        const ta = await X().extractText(S.A.pdf, f => setBar(f * 0.15), sig);
        const tb = await X().extractText(S.B.pdf, f => setBar(0.15 + f * 0.15), sig);
        PL.abortIf({ signal: sig });
        log.set('Comparing text…');
        S.text = { ta, tb, hasText: ta.tokens.length + tb.tokens.length > 0 };
        const d = X().diffText(ta, tb, { ignoreCase: root.querySelector('#cmp_case').checked });
        S.diff = d; S.hunks = d.hunks;
        const nA = S.A.pdf.numPages, nB = S.B.pdf.numPages, n = Math.max(nA, nB);
        S.nPages = n;
        const textPages = new Set();
        d.hunks.forEach(h => { textPages.add(h.be > h.bs ? tb.page[h.bs] : ta.page[h.as]); if (h.ae > h.as) textPages.add(ta.page[h.as]); });
        S.pages = Array.from({ length: n }, (_, i) => ({ status: 'pending', changed: 0, pct: 0, text: textPages.has(i), sizeDiffers: false }));
        results.style.display = ''; buildStrip(); renderSummary(); renderHunks();
        // visual pass, page by page (stats only — pages are re-rendered at full size when viewed)
        for (let i = 1; i <= n; i++) {
          PL.abortIf({ signal: sig });
          log.set('Comparing pages — ' + i + '/' + n + '…'); setBar(0.3 + 0.7 * (i - 1) / n);
          const P = S.pages[i - 1];
          if (i > nA) { P.status = 'onlyB'; }
          else if (i > nB) { P.status = 'onlyA'; }
          else {
            const { ca, cb } = await pair(i, pageW);
            const r = X().pixelDiff(ca, cb, { render: false });
            PL.freeCanvas(ca); PL.freeCanvas(cb);
            P.changed = r.changed; P.pct = r.pct; P.sizeDiffers = r.sizeDiffers;
            P.status = (r.changed >= 25 || P.text) ? 'diff' : 'same';
          }
          paintStrip(i - 1); if (i === 1 || i % 4 === 0 || i === n) renderSummary();
          if (i % 2 === 0) await PL.tick();
        }
        renderSummary(); setBar(1);
        const first = S.pages.findIndex(p => p.status !== 'same');
        await show(first < 0 ? 0 : first);
        const diffN = S.pages.filter(p => p.status !== 'same').length;
        log.set((diffN || d.removed || d.added ? 'Done — differences found' : 'Done — the documents look identical') + ' (' + Math.round((performance.now() - t0) / 1000) + ' s).', diffN || d.removed || d.added ? 'err' : 'ok');
      } catch (e) {
        log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Failed: ' + PL.friendlyError(e), 'err');
      }
      S.running = false; stop.style.display = 'none'; go.disabled = !(S.A && S.B); swap.disabled = false;
      PL.busy = null;
    };
    stop.onclick = () => { if (S.ac) S.ac.abort(); log.set('Cancelling…'); };

    /* ── summary, strip, hunks ── */
    function renderSummary() {
      const d = S.diff, n = S.nPages;
      const diffPages = S.pages.filter(p => p.status === 'diff' || p.status === 'onlyA' || p.status === 'onlyB').length;
      const pending = S.pages.filter(p => p.status === 'pending').length;
      const cells = [
        ['Pages', S.A.pdf.numPages + ' vs ' + S.B.pdf.numPages, S.A.pdf.numPages === S.B.pdf.numPages ? '' : 'warn'],
        ['Pages with changes', diffPages + ' of ' + n + (pending ? ' …' : ''), diffPages ? 'warn' : 'ok'],
        ['Words removed', d.removed, d.removed ? 'del' : ''],
        ['Words added', d.added, d.added ? 'ins' : '']
      ];
      sum.innerHTML = '';
      cells.forEach(([k, v, c]) => { const e = PL.el('div', 'stat ' + c); e.innerHTML = '<b></b><span></span>'; e.querySelector('b').textContent = v; e.querySelector('span').textContent = k; sum.appendChild(e); });
      if (!S.text.hasText) sum.appendChild(PL.el('div', 'note full', 'These PDFs have no selectable text (scans?) — only the visual comparison is available. Run <b>Searchable</b> first to compare text as well.'));
      if (d.approx) sum.appendChild(PL.el('div', 'note full', 'The documents are very different, so words were compared page by page.'));
    }
    function buildStrip() {
      strip.innerHTML = '';
      S.pages.forEach((p, i) => {
        const b = PL.el('button', 'pg pending', String(i + 1)); b.type = 'button'; b.setAttribute('role', 'listitem');
        b.onclick = () => show(i);
        strip.appendChild(b);
      });
    }
    const STATUS_LABEL = { same: 'identical', diff: 'has changes', onlyA: 'only in A', onlyB: 'only in B', pending: 'checking' };
    function paintStrip(i) {
      const b = strip.children[i]; if (!b) return;
      const p = S.pages[i];
      b.className = 'pg ' + p.status + (i === S.cur ? ' cur' : '');
      b.title = 'Page ' + (i + 1) + ' — ' + STATUS_LABEL[p.status]; b.setAttribute('aria-label', b.title);
    }
    function renderHunks() {
      hlist.innerHTML = '';
      const { ta, tb } = S.text, hs = S.hunks, LIMIT = 300;
      const ctxN = 6;
      const mk = (h) => {
        const li = PL.el('li');
        const pg = h.be > h.bs ? tb.page[h.bs] : ta.page[h.as];
        const badge = PL.el('button', 'hbadge', 'p.' + (pg + 1)); badge.type = 'button'; badge.onclick = () => show(pg);
        li.appendChild(badge);
        const txt = PL.el('span', 'htxt');
        const add = (t, cls) => { if (!t) return; const e = PL.el(cls || 'span'); e.textContent = t + ' '; txt.appendChild(e); };
        add((h.as > ctxN ? '… ' : '') + ta.tokens.slice(Math.max(0, h.as - ctxN), h.as).join(' '));
        if (h.ae > h.as) add(ta.tokens.slice(h.as, h.ae).join(' '), 'del');
        if (h.be > h.bs) add(tb.tokens.slice(h.bs, h.be).join(' '), 'ins');
        add(ta.tokens.slice(h.ae, h.ae + ctxN).join(' ') + (h.ae + ctxN < ta.tokens.length ? ' …' : ''));
        li.appendChild(txt);
        return li;
      };
      hs.slice(0, LIMIT).forEach(h => hlist.appendChild(mk(h)));
      if (hs.length > LIMIT) {
        const more = PL.el('li', 'hmore'); const b = PL.el('button', 'btn ghost sm', 'Show all ' + hs.length + ' changes'); b.type = 'button';
        b.onclick = () => { more.remove(); hs.slice(LIMIT).forEach(h => hlist.appendChild(mk(h))); };
        more.appendChild(b); hlist.appendChild(more);
      }
      if (!hs.length) hlist.appendChild(PL.el('li', 'hnone', S.text.hasText ? 'No word-level differences.' : 'No text to compare.'));
      results.querySelector('.hunks > summary').textContent = 'Text changes (' + hs.length + ')';
    }

    /* ── page viewer ── */
    async function show(i) {
      if (i < 0 || i >= S.nPages) return;
      const tok = ++S.token;
      S.cur = i; S.pages.forEach((_, k) => paintStrip(k));
      pgno.textContent = 'Page ' + (i + 1) + ' / ' + S.nPages;
      const P = S.pages[i];
      stage.innerHTML = '<div class="cmp-wait">Rendering page…</div>';
      try {
        const { ca, cb } = await pair(i + 1, viewW());
        if (tok !== S.token) { PL.freeCanvas(ca); PL.freeCanvas(cb); return; }
        const r = X().pixelDiff(ca, cb, { render: true });
        PL.freeCanvas(ca); PL.freeCanvas(cb);
        freeCache(); S.cache = { i, r };
        drawMode();
        const info = P.status === 'onlyA' ? 'This page exists only in A (removed in B).' : P.status === 'onlyB' ? 'This page exists only in B (added).'
          : P.sizeDiffers ? 'Page sizes differ between A and B — compared from the top-left corner.' : '';
        if (info) stage.insertBefore(PL.el('div', 'note', info), stage.firstChild);
      } catch (e) {
        if (tok === S.token) stage.innerHTML = '<div class="note">Could not render this page: ' + esc(PL.friendlyError(e)) + '</div>';
      }
    }
    function labelled(cv, label) {
      const f = PL.el('figure', 'cmp-fig'); const c = PL.el('figcaption', null, label);
      cv.removeAttribute('style'); f.append(c, cv); return f;
    }
    function drawMode() {
      const c = S.cache; if (!c) return;
      stage.innerHTML = '';
      const { r } = c;
      if (S.mode === 'diff') {
        stage.appendChild(labelled(r.canvas, 'Differences · red = only in A, blue = only in B'));
      } else if (S.mode === 'side') {
        const g = PL.el('div', 'cmp-side');
        g.append(labelled(r.A, 'A · ' + S.A.name), labelled(r.B, 'B · ' + S.B.name));
        stage.appendChild(g);
      } else {
        const w = PL.el('div', 'swipe');
        const base = r.B, top = r.A; base.className = 'sw-base'; top.className = 'sw-top';
        const rng = PL.el('input'); rng.type = 'range'; rng.min = 0; rng.max = 100; rng.value = 50; rng.setAttribute('aria-label', 'Swipe between A and B');
        const line = PL.el('i', 'sw-line');
        const upd = () => { top.style.clipPath = 'inset(0 ' + (100 - rng.value) + '% 0 0)'; line.style.left = rng.value + '%'; };
        rng.oninput = upd; upd();
        w.append(base, top, line, rng);
        const cap = PL.el('div', 'cmp-cap', 'Drag the slider · left = A, right = B');
        stage.append(w, cap);
      }
    }
    results.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.m) {
        S.mode = t.dataset.m;
        results.querySelectorAll('.cmp-modes .chip').forEach(b => { const on = b === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
        // swipe/side re-use canvases that diff mode already placed in the DOM → rebuild from the cache
        if (S.cache) { const c = S.cache; c.r.A.removeAttribute('class'); c.r.B.removeAttribute('class'); drawMode(); }
      } else if (t.dataset.a === 'prev') show((S.cur - 1 + S.nPages) % S.nPages);
      else if (t.dataset.a === 'next') show((S.cur + 1) % S.nPages);
      else if (t.dataset.a === 'chg') {
        for (let k = 1; k <= S.nPages; k++) { const j = (S.cur + k) % S.nPages; if (S.pages[j].status !== 'same' && S.pages[j].status !== 'pending') { show(j); return; } }
        log.set('No other pages with changes.', 'ok');
      } else if (t.dataset.a === 'report') makeReport();
    });

    /* ── report (self-contained HTML — prints to PDF from any browser) ── */
    async function makeReport() {
      if (!S.diff) return;
      const btn = results.querySelector('[data-a="report"]'); btn.disabled = true;
      try {
        const MAXIMG = PL.env.mobile ? 15 : 40;
        const changed = S.pages.map((p, i) => ({ p, i })).filter(x => x.p.status !== 'same' && x.p.status !== 'pending');
        let h = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PaperLab comparison</title>' +
          '<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:22px}h2{font-size:17px;margin-top:28px}' +
          'ins{background:#d1fae5;color:#065f46;text-decoration:none;padding:0 2px}del{background:#fee2e2;color:#991b1b;padding:0 2px}li{margin:6px 0}img{max-width:100%;border:1px solid #ccc}.m{color:#666;font-size:13px}</style>';
        h += '<h1>PaperLab — PDF comparison</h1><p class="m">A: ' + esc(S.A.name) + ' (' + S.A.pdf.numPages + ' pages)<br>B: ' + esc(S.B.name) + ' (' + S.B.pdf.numPages + ' pages)<br>' +
          'Words removed: ' + S.diff.removed + ' · added: ' + S.diff.added + ' · pages with changes: ' + changed.length + ' of ' + S.nPages + '</p>';
        h += '<h2>Text changes</h2><ol>';
        const { ta, tb } = S.text;
        S.hunks.slice(0, 2000).forEach(x => {
          const pg = (x.be > x.bs ? tb.page[x.bs] : ta.page[x.as]) + 1;
          h += '<li><span class="m">p.' + pg + '</span> ' + esc(ta.tokens.slice(Math.max(0, x.as - 6), x.as).join(' ')) + ' ' +
            (x.ae > x.as ? '<del>' + esc(ta.tokens.slice(x.as, x.ae).join(' ')) + '</del> ' : '') +
            (x.be > x.bs ? '<ins>' + esc(tb.tokens.slice(x.bs, x.be).join(' ')) + '</ins> ' : '') +
            esc(ta.tokens.slice(x.ae, x.ae + 6).join(' ')) + '</li>';
        });
        if (!S.hunks.length) h += '<li>No word-level differences.</li>';
        h += '</ol><h2>Visual differences</h2><p class="m">Red = only in A · blue = only in B · yellow = changed area' + (changed.length > MAXIMG ? ' · showing the first ' + MAXIMG + ' pages' : '') + '</p>';
        let k = 0;
        for (const { p, i } of changed) {
          if (k++ >= MAXIMG) break;
          setBar(k / Math.min(MAXIMG, changed.length)); log.set('Building report — page ' + (i + 1) + '…');
          h += '<h3>Page ' + (i + 1) + ' — ' + STATUS_LABEL[p.status] + '</h3>';
          if (p.status === 'diff') {
            const { ca, cb } = await pair(i + 1, 900);
            const r = X().pixelDiff(ca, cb, { render: true });
            h += '<img alt="Differences on page ' + (i + 1) + '" src="' + r.canvas.toDataURL('image/jpeg', 0.72) + '">';
            [ca, cb, r.canvas, r.A, r.B].forEach(c => PL.freeCanvas(c));
          }
        }
        h += '</html>';
        const a = PL.download(new Blob([h], { type: 'text/html' }), 'paperlab-comparison.html', 'text/html');
        repOut.innerHTML = ''; repOut.appendChild(a);
        if (!PL.env.mobile) a.click();
        log.set('Report ready — open it in a browser and print to save as PDF.', 'ok');
      } catch (e) { log.set('Could not build the report: ' + PL.friendlyError(e), 'err'); }
      btn.disabled = false;
    }
  });
})(window.PaperLab);
