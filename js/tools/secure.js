/* PaperLab tool: Password protect / Unlock.  Engine: js/secure/engine.js (QPDF → WebAssembly, shared with Mass Batch). */
(function (PL) {
  PL.register('secure', function (root) {
    let file = null, tab = 'protect', running = false, ac = null;

    const tabs = PL.el('div', 'chips'); tabs.setAttribute('role', 'tablist');
    [['protect', 'Password-protect'], ['unlock', 'Unlock (remove password)']].forEach(([v, t]) => {
      const b = PL.el('button', 'chip', t); b.type = 'button'; b.dataset.v = v; b.setAttribute('role', 'tab'); b.onclick = () => setTab(v); tabs.appendChild(b);
    });
    root.appendChild(tabs);

    root.appendChild(PL.dropZone(fs => { file = fs[0]; info.textContent = file.name + ' · ' + PL.fmtBytes(file.size); res.style.display = 'none'; out.innerHTML = ''; sync(); }, '.pdf,application/pdf', false));
    const info = PL.el('div', 'log'); root.appendChild(info);

    const boxP = PL.el('div'), boxU = PL.el('div');
    const FP = PL.buildFields(PL.ops.protect.fields), FU = PL.buildFields(PL.ops.unlock.fields);
    boxP.appendChild(FP.el); boxU.appendChild(FU.el);

    // confirm-password field right under the password
    const conf = PL.el('div', 'field');
    conf.innerHTML = '<label for="s_conf">Repeat the password</label><input id="s_conf" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off">';
    const pwBox = FP.inputs.password.parentNode; pwBox.parentNode.insertBefore(conf, pwBox.nextSibling);
    const strength = PL.el('div', 'log'); strength.id = 's_strength'; pwBox.parentNode.insertBefore(strength, conf.nextSibling);
    const show = PL.el('div', 'field check'); show.innerHTML = '<input type="checkbox" id="s_show"><label for="s_show">Show passwords</label>';
    root.appendChild(show);
    show.querySelector('input').addEventListener('change', e => root.querySelectorAll('input[id^="f_password"], input[id^="f_owner"], #s_conf').forEach(i => { i.type = e.target.checked ? 'text' : 'password'; }));

    root.appendChild(boxP); root.appendChild(boxU);
    const noteP = PL.el('div', 'note');
    noteP.innerHTML = '<b>If you forget the password, nobody can recover the file</b> — not you, not PaperLab. Passwords never leave your device and are not stored. Use 12+ characters. The restrictions (printing, copying, editing) are honoured by most viewers but are weaker than the open-password.';
    const noteU = PL.el('div', 'note');
    noteU.innerHTML = 'Removes the password from a file <b>you are allowed to open</b>, using the password you supply. PaperLab cannot guess or crack passwords. A file with only editing/printing restrictions (no open-password) can be unlocked with the field left empty — do this only for files you own or have permission to change.';
    root.appendChild(noteP); root.appendChild(noteU);

    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Protect'); go.disabled = true;
    const stop = PL.el('button', 'btn ghost', 'Cancel'); stop.style.display = 'none';
    actions.append(go, stop); root.appendChild(actions);
    const log = PL.logger(root);
    const res = PL.el('div', 'result'); res.style.display = 'none'; root.appendChild(res);
    const out = PL.el('div', 'out'); root.appendChild(out);

    function rate(p) {
      if (!p) return '';
      let k = 0; if (p.length >= 8) k++; if (p.length >= 12) k++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) k++; if (/\d/.test(p)) k++; if (/[^A-Za-z0-9]/.test(p)) k++;
      return ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][k] + (k < 3 ? ' — use a longer password' : '');
    }
    function sync() {
      boxP.style.display = noteP.style.display = tab === 'protect' ? '' : 'none';
      boxU.style.display = noteU.style.display = tab === 'unlock' ? '' : 'none';
      conf.style.display = strength.style.display = show.style.display = tab === 'protect' ? '' : 'none';
      if (tab === 'unlock') show.style.display = '';
      FP.sync();
      strength.textContent = rate(FP.inputs.password.value);
      go.disabled = !file || running;
    }
    FP.inputs.password.addEventListener('input', sync);
    function setTab(v) {
      tab = v;
      tabs.querySelectorAll('.chip').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      go.textContent = v === 'protect' ? 'Protect' : 'Unlock';
      res.style.display = 'none'; out.innerHTML = ''; log.set('');
      sync();
    }

    go.onclick = async () => {
      running = true; ac = new AbortController(); go.disabled = true; stop.style.display = ''; out.innerHTML = ''; res.style.display = 'none';
      PL.busy = () => running; PL.cleanup = () => ac.abort();
      try {
        const stem = file.name.replace(/\.pdf$/i, '');
        const buf = new Uint8Array(await PL.readArrayBuffer(file));
        const ctx = { signal: ac.signal, name: file.name, progress: (f, m) => log.set((tab === 'protect' ? 'Protecting' : 'Unlocking') + ' — ' + m + '…') };
        let r;
        if (tab === 'protect') {
          const o = FP.values();
          if (!o.password) throw new Error('Enter a password');
          if (o.password !== root.querySelector('#s_conf').value) throw new Error('The two passwords do not match');
          log.set('Loading the encryption engine…');
          r = await PL.secure.protect(buf, o, ctx);
          out.appendChild(PL.download(r.bytes, stem + '-protected.pdf'));
        } else {
          log.set('Loading the encryption engine…');
          r = await PL.secure.unlock(buf, FU.values(), ctx);
          out.appendChild(PL.download(r.bytes, stem + '-unlocked.pdf'));
        }
        log.set('Done — ' + r.note + ' (' + PL.fmtBytes(file.size) + ' → ' + PL.fmtBytes(r.bytes.length) + ').', 'ok');
      } catch (e) { log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Failed: ' + PL.friendlyError(e), 'err'); }
      running = false; stop.style.display = 'none'; go.disabled = !file; PL.busy = null; PL.cleanup = null;
    };
    stop.onclick = () => { if (ac) ac.abort(); log.set('Cancelling…'); };
    setTab('protect');
  });
})(window.PaperLab);
