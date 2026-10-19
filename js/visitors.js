/* PaperLab — visitor counter.
   Total via counterapi.dev (free, CORS, no signup) + localStorage cache.
   Today via localStorage (once per calendar day per browser). */
(function () {
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
  const lastDate = localStorage.getItem('pl-seen-date');
  if (lastDate && lastDate !== todayStr) {
    localStorage.setItem('pl-today-count', '0');
  }
  const seenSess = sessionStorage.getItem('pl-counted') === '1';
  let todayCount = parseInt(localStorage.getItem('pl-today-count') || '0');
  if (!seenSess) {
    todayCount += 1;
    localStorage.setItem('pl-today-count', todayCount);
    localStorage.setItem('pl-seen-date', todayStr);
    sessionStorage.setItem('pl-counted', '1');
  }
  setToday(todayCount || 1);

  // ── TOTAL count — counterapi.dev (once per session) ──
  const hitAPI = sessionStorage.getItem('pl-total-hit') !== '1';
  const endpoint = hitAPI
    ? 'https://api.counterapi.dev/v1/eknathalabs/paperlab-total/up'
    : 'https://api.counterapi.dev/v1/eknathalabs/paperlab-total';

  fetch(endpoint)
    .then(r => r.json())
    .then(d => {
      const val = d.count || d.value || d.hits;
      if (val == null) throw new Error('no count field');
      if (hitAPI) sessionStorage.setItem('pl-total-hit', '1');
      setTotal(val);
      localStorage.setItem('pl-total-cache', val);
    })
    .catch(() => {
      const cached = localStorage.getItem('pl-total-cache');
      setTotal(cached ? Number(cached) : '—');
    });
})();
