/* PaperLab — app boot. Renders grid from registry, opens tool builders. */
(function (PL) {
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
    if (typeof builder === 'function') {
      builder(wsBody);
    } else {
      wsBody.appendChild(PL.el('div', 'note', 'This tool failed to load. Check that js/tools/' + tool.id + '.js is present.'));
    }
  }

  function closeWs() { ws.classList.remove('open'); wsBody.innerHTML = ''; }

  document.getElementById('wsClose').onclick = closeWs;
  ws.onclick = e => { if (e.target === ws) closeWs(); };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ws.classList.contains('open')) closeWs();
  });

  PL.registry.forEach(item => {
    if (item.g) {
      const l = PL.el('div', 'group-label', item.g);
      grid.appendChild(l);
      return;
    }
    const c = PL.el('div', 'card' + (item.soon ? ' soon' : ''));
    c.tabIndex = item.soon ? -1 : 0;
    c.setAttribute('role', 'button');
    c.innerHTML =
      (item.soon ? '<span class="badge">soon</span>' : '') +
      `<span class="ico">${item.ico}</span><h3>${item.t}</h3><p>${item.d}</p>`;
    if (!item.soon) {
      c.onclick = () => openTool(item);
      c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTool(item); } };
    }
    grid.appendChild(c);
  });
})(window.PaperLab);
