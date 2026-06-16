/* PaperLab — app boot. Renders primary + secondary tools, opens tool builders. */
(function (PL) {
  const primaryWrap = document.getElementById('primary');
  const grid = document.getElementById('grid');
  const ws = document.getElementById('ws');
  const wsBody = document.getElementById('wsBody');
  const wsTitle = document.getElementById('wsTitle');
  const wsIco = document.getElementById('wsIco');

  function openTool(tool) {
    const builder = PL.tools[tool.id];
    wsTitle.textContent = tool.t;
    wsIco.textContent = tool.ico;
    wsBody.innerHTML = '';
    ws.classList.add('open');
    if (typeof builder === 'function') builder(wsBody);
    else wsBody.appendChild(PL.el('div', 'note', 'This tool failed to load. Check that js/tools/' + tool.id + '.js is present.'));
  }
  function closeWs() { ws.classList.remove('open'); wsBody.innerHTML = ''; }

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
})(window.PaperLab);
