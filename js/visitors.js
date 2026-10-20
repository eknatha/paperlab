/* Patram — visitor counter.
   Total: a free, keyless, CORS-enabled counting service (tries the providers below in order).
   Today: localStorage (once per calendar day per browser).
   History: the original counterapi.dev v1 API was switched off on 7 Aug 2026 (that is why the number stopped moving).
   Set BASELINE to the last total you saw before then, so the new counter continues from it. */
(function () {
  const BASELINE = 0;                       // ← add your old total here (e.g. 4210); it is added to every provider's count
  const NS = 'patram.eknathalabs.com', KEY = 'visits';
  const PROVIDERS = [
    { name: 'abacus',
      hit: 'https://abacus.jasoncameron.dev/hit/' + NS + '/' + KEY,
      get: 'https://abacus.jasoncameron.dev/get/' + NS + '/' + KEY },
    { name: 'countapi',
      hit: 'https://countapi.mileshilliard.com/api/v1/hit/' + NS.replace(/\./g, '_') + '_' + KEY,
      get: 'https://countapi.mileshilliard.com/api/v1/get/' + NS.replace(/\./g, '_') + '_' + KEY }
  ];
  const S = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    sget: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  function fmt(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString();
  }
  const totalEl = document.getElementById('totalCount');
  const todayEl = document.getElementById('todayBadge');

  function setTotal(val) {
    if (!totalEl) return;
    totalEl.textContent = fmt(val);
    totalEl.classList.remove('loading');
  }
  function setToday(n) {
    if (!todayEl) return;
    todayEl.textContent = '+' + fmt(n) + ' today';
  }

  // ── TODAY count (localStorage, once per day per browser) ──
  const todayStr = new Date().toISOString().slice(0, 10);
  if (S.get('pl-seen-date') && S.get('pl-seen-date') !== todayStr) S.set('pl-today-count', '0');
  let todayCount = parseInt(S.get('pl-today-count') || '0', 10) || 0;
  if (S.sget('pl-counted') !== '1') {
    todayCount += 1;
    S.set('pl-today-count', String(todayCount));
    S.set('pl-seen-date', todayStr);
    S.sset('pl-counted', '1');
  }
  setToday(todayCount || 1);

  // ── TOTAL count ──
  function readCount(d) {
    const v = d && (d.value != null ? d.value : d.count != null ? d.count : d.hits);
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }
  async function call(url) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 6000);
    try {
      const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      const n = readCount(await r.json());
      if (n == null) throw new Error('no count in response');
      return n;
    } finally { clearTimeout(t); }
  }
  async function total() {
    const needHit = S.sget('pl-total-hit2') !== '1';
    for (const p of PROVIDERS) {
      try {
        let n;
        if (needHit) {
          try { n = await call(p.hit); S.sset('pl-total-hit2', '1'); }
          catch (e) {
            if (e.status !== 404) throw e;
            n = await call(p.get);                       // counter missing: read instead of failing
          }
        } else n = await call(p.get);
        return n;
      } catch (e) { /* try next provider */ }
    }
    return null;
  }
  const cached = Number(S.get('pl-total-cache2'));
  if (cached > 0) setTotal(cached);                       // show last known value immediately, then refresh
  total().then(n => {
    if (n == null) { if (!(cached > 0)) setTotal(BASELINE > 0 ? BASELINE : null); return; }
    const val = n + BASELINE;
    setTotal(val);
    S.set('pl-total-cache2', String(val));
  });
})();
