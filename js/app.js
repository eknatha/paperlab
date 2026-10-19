/* PaperLab — app boot. Renders primary + secondary tools, opens tool builders. */
(function (PL) {
  const primaryWrap = document.getElementById('primary');
  const grid = document.getElementById('grid');
  const ws = document.getElementById('ws');
  const wsBody = document.getElementById('wsBody');
  const wsTitle = document.getElementById('wsTitle');
  const wsIco = document.getElementById('wsIco');
  let pushed = false;                                   // did we add a history entry for the open workspace?

  function openTool(tool) {
    const builder = PL.tools[tool.id];
    if (PL.cleanup) { try { PL.cleanup(); } catch (e) { /* ignore */ } }
    PL.busy = null; PL.cleanup = null;
    wsTitle.textContent = tool.t;
    wsIco.textContent = tool.ico;
    wsBody.innerHTML = '';
    if (PL.caution) wsBody.appendChild(PL.caution(tool.id));          // responsible-use notice, always on top
    ws.classList.add('open');
    document.body.classList.add('ws-open');             // stop the page behind the sheet from scrolling (mobile)
    ws.scrollTop = 0;
    if (!pushed) { try { history.pushState({ pl: 1 }, ''); pushed = true; } catch (e) { /* ignore */ } }
    if (typeof builder === 'function') {
      try { builder(wsBody); }
      catch (e) { wsBody.appendChild(PL.el('div', 'note', 'This tool failed to start: ' + (e && e.message || e))); console.error(e); }
    } else wsBody.appendChild(PL.el('div', 'note', 'This tool failed to load. Check that js/tools/' + tool.id + '.js is present.'));
  }

  /* returns false if the user chose to keep a running job alive */
  function confirmStop() {
    if (PL.busy && PL.busy()) return window.confirm('A job is still running. Stop it and close this tool?');
    return true;
  }
  function reallyClose() {
    if (PL.cleanup) { try { PL.cleanup(); } catch (e) { /* ignore */ } }
    PL.busy = null; PL.cleanup = null;
    ws.classList.remove('open');
    document.body.classList.remove('ws-open');
    wsBody.innerHTML = '';
  }
  /* History: opening a tool pushes ONE entry so the phone's Back button closes the tool instead of leaving the site.
     Closing with ✕ / Esc / tapping outside deliberately does NOT call history.back() — that navigation is asynchronous and
     would race with a tool opened right afterwards. The entry simply stays; a later Back press consumes it harmlessly. */
  function closeWs() {
    if (!ws.classList.contains('open')) return;
    if (!confirmStop()) return;
    reallyClose();
  }
  window.addEventListener('popstate', () => {
    pushed = false;                                     // the browser just consumed our entry
    if (!ws.classList.contains('open')) return;
    if (confirmStop()) reallyClose();
    else { try { history.pushState({ pl: 1 }, ''); pushed = true; } catch (e) { /* ignore */ } }
  });

  document.getElementById('wsClose').onclick = closeWs;
  ws.onclick = e => { if (e.target === ws) closeWs(); };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ws.classList.contains('open')) closeWs();
  });

  function activate(el, tool) {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.onclick = () => openTool(tool);
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTool(tool); } };
  }
  PL.openToolById = id => { const t = PL.registry.find(x => x.id === id); if (t) openTool(t); };

  // ----- primary tools (oversized) -----
  const primaries = PL.registry.filter(it => it.primary);
  if (primaryWrap && primaries.length) {
    const row = PL.el('div', 'primary-tools');
    primaries.forEach(tool => {
      const c = PL.el('div', 'ptool');
      c.innerHTML =
        '<span class="go">→</span>' +
        `<div class="pico">${tool.ico}</div>` +
        `<h3>${tool.t}</h3><p>${tool.d}</p>`;
      activate(c, tool);
      row.appendChild(c);
    });
    primaryWrap.appendChild(row);
  }

  // ----- secondary tools (grouped) -----
  let curGrid = null;
  PL.registry.forEach(item => {
    if (item.primary) return;
    if (item.g) {
      const sec = PL.el('div', 'section');
      sec.innerHTML = `<div class="sec-head"><h2>${item.g}</h2><span class="rule"></span></div>`;
      curGrid = PL.el('div', 'grid');
      sec.appendChild(curGrid);
      grid.appendChild(sec);
      return;
    }
    const c = PL.el('div', 'card' + (item.soon ? ' soon' : ''));
    c.innerHTML =
      (item.soon ? '<span class="badge">soon</span>' : '<span class="arrow">→</span>') +
      `<div class="top"><span class="ico">${item.ico}</span><h3>${item.t}</h3></div>` +
      `<p>${item.d}</p>`;
    if (!item.soon) activate(c, item);
    (curGrid || grid).appendChild(c);
  });
  if (PL.initEthicsBar) PL.initEthicsBar();
})(window.PaperLab);
