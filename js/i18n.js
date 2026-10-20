/* Patram — interface languages.
   English · हिन्दी · తెలుగు · தமிழ் · ಕನ್ನಡ · മലയാളം · मराठी · বাংলা · ଓଡ଼ିଆ · ਪੰਜਾਬੀ · Español · Русский
   Strings live in js/i18n/<code>.js (id → text). English text is the key for plain strings, so any control whose label is
   in the dictionary is translated automatically; anything not in a dictionary simply stays in English.
   Changing the language saves the choice and reloads the page, so every tool is built in the chosen language. */
window.PaperLab = window.PaperLab || { tools: {} };
(function (PL) {
  const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['te', 'తెలుగు'], ['ta', 'தமிழ்'], ['kn', 'ಕನ್ನಡ'], ['ml', 'മലയാളം'], ['mr', 'मराठी'],
    ['bn', 'বাংলা'], ['or', 'ଓଡ଼ିଆ'], ['pa', 'ਪੰਜਾਬੀ'], ['es', 'Español'], ['ru', 'Русский']];
  const codes = LANGS.map(l => l[0]);
  const GROUP_ID = { 'Power tools': 'g_power', 'Pages': 'g_pages', 'Convert': 'g_convert', 'Security': 'g_security', 'Mark & inspect': 'g_mark' };
  const STATUS = ['st_done', 'st_cancelling', 'st_cancelled', 'st_failed', 'st_done2', 'st_reading', 'st_building'];

  function pick() {
    let s = null; try { s = localStorage.getItem('pl-lang'); } catch (e) { /* storage blocked */ }
    if (s && codes.indexOf(s) >= 0) return s;
    const nav = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
    for (const l of nav) { const c = String(l).toLowerCase().split('-')[0]; if (codes.indexOf(c) >= 0) return c; }
    return 'en';
  }
  const lang = pick();
  const v = (document.currentScript && document.currentScript.src.split('?')[1]) || '';
  const base = (document.currentScript && document.currentScript.src.replace(/js\/i18n\.js.*$/, '')) || '';
  // load dictionaries synchronously (parser-blocking) so every later script can call PL.t at build time
  document.write('<script src="' + base + 'js/i18n/en.js' + (v ? '?' + v : '') + '"><\/script>');
  if (lang !== 'en') document.write('<script src="' + base + 'js/i18n/' + lang + '.js' + (v ? '?' + v : '') + '"><\/script>');
  document.documentElement.setAttribute('lang', lang);

  const D = () => PL.i18nData || {};
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  let REV = null;
  function rev() {
    if (REV) return REV; REV = {};
    const en = D().en || {};
    Object.keys(en).forEach(id => { if (id === 'g_convert' || /[<>]/.test(en[id]) || /\{n\}/.test(en[id])) return; REV[norm(en[id])] = id; });
    return REV;
  }
  PL.lang = lang; PL.LANGS = LANGS;
  PL.t = function (id, vars) {
    const d = D(); let s = (d[lang] && d[lang][id]) || (d.en && d.en[id]) || id;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  };
  /* translate an English UI string (exact match, or a known status prefix such as “Done —”) */
  PL.tr = function (text) {
    if (lang === 'en' || text == null) return text;
    const d = D(), L = d[lang] || {}, en = d.en || {}, R = rev(), n = norm(text);
    if (R[n] && L[R[n]]) return L[R[n]];
    for (const id of STATUS) { const p = en[id]; if (p && String(text).indexOf(p) === 0 && L[id]) return L[id] + String(text).slice(p.length); }
    return text;
  };
  PL.groupT = name => (GROUP_ID[name] ? PL.t(GROUP_ID[name]) : PL.tr(name));

  /* ---- DOM pass ---- */
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 0, CODE: 1, PRE: 1 };
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function fixText(node) {
    const raw = node.nodeValue; if (!raw || !/\S/.test(raw)) return;
    const t = PL.tr(norm(raw)); if (t !== norm(raw)) node.nodeValue = raw.replace(/\S[\s\S]*\S|\S/, () => t);
  }
  function walk(node) {
    if (node.nodeType === 3) { const p = node.parentNode; if (!p || SKIP[p.nodeName] || (p.classList && p.classList.contains('nm'))) return; fixText(node); return; }
    if (node.nodeType !== 1 || SKIP[node.nodeName] || node.hasAttribute('translate') && node.getAttribute('translate') === 'no' || node.classList && node.classList.contains('nm')) return;
    ATTRS.forEach(a => { if (node.hasAttribute(a)) { const o = node.getAttribute(a), t = PL.tr(o); if (t !== o) node.setAttribute(a, t); } });
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
  }
  function applyData(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(el => {
      const id = el.getAttribute('data-i18n'), vars = id === 'sub' ? { n: (PL.registry || []).filter(x => x.id && !x.soon).length } : null;
      el.innerHTML = PL.t(id, vars); if (lang !== 'en') el.removeAttribute('hidden');
    });
  }
  PL.i18nApply = function (root) { applyData(root); if (lang !== 'en') walk(root || document.body); };

  function picker() {
    const host = document.querySelector('.nav-tag') || document.querySelector('.topbar'); if (!host || document.getElementById('langSel')) return;
    const sel = document.createElement('select'); sel.id = 'langSel'; sel.className = 'langsel'; sel.setAttribute('aria-label', 'Language'); sel.setAttribute('translate', 'no');
    LANGS.forEach(([c, n]) => { const o = document.createElement('option'); o.value = c; o.textContent = n; o.lang = c; sel.appendChild(o); });
    sel.value = lang;
    sel.onchange = () => { try { localStorage.setItem('pl-lang', sel.value); } catch (e) { /* ignore */ } location.reload(); };
    if (host.classList.contains('nav-tag')) host.insertBefore(sel, host.firstChild); else host.appendChild(sel);
  }
  function boot() {
    picker(); PL.i18nApply(document.body);
    if (lang !== 'en' && window.MutationObserver) {
      new MutationObserver(ms => { ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 || n.nodeType === 3) walk(n); })); })
        .observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.PaperLab);
