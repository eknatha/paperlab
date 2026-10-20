/* Patram — responsible-use notices.
   Every tool opens with a short caution (always visible), the footer links to the full policy, and first-time visitors see a
   dismissible bar. Cautions are deliberately short; the policy page (responsible-use.html) has the detail. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  PL.caution = function (id) {
    const box = document.createElement('div');
    box.className = 'caution'; box.setAttribute('role', 'note');
    const en = (PL.i18nData && PL.i18nData.en) || {};
    box.innerHTML = '<span class="cico" aria-hidden="true">⚠</span><div><b>' + PL.t('use_resp') + '</b> ' + (en['c_' + id] ? PL.t('c_' + id) + ' ' : '') + PL.t('c_base') +
      ' <a href="responsible-use.html" target="_blank" rel="noopener">' + PL.t('pol') + '</a></div>';
    return box;
  };

  /* first-visit bar on the home page */
  PL.initEthicsBar = function () {
    let seen = false; try { seen = localStorage.getItem('pl_ethics_ack') === '1'; } catch (e) { /* storage unavailable */ }
    if (seen) return;
    const bar = document.getElementById('ethicsBar'); if (!bar) return;
    bar.hidden = false;
    const ok = bar.querySelector('button');
    if (ok) ok.onclick = () => { bar.hidden = true; try { localStorage.setItem('pl_ethics_ack', '1'); } catch (e) { /* ignore */ } };
  };
})(window.PaperLab);
