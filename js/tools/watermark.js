/* Patram tool: Watermark — visible text, invisible tracking mark, per-recipient copies, and a mark checker. */
(function (PL) {
  PL.register('watermark', function (root) {
    let file = null, tab = 'add', running = false, ac = null;

    const tabs = PL.el('div', 'chips'); tabs.setAttribute('role', 'tablist');
    [['add', 'Add watermark'], ['check', 'Check a file for a mark']].forEach(([v, t]) => {
      const b = PL.el('button', 'chip', t); b.type = 'button'; b.dataset.v = v; b.setAttribute('role', 'tab');
      b.onclick = () => setTab(v); tabs.appendChild(b);
    });
    root.appendChild(tabs);

    const dz = PL.dropZone(fs => { file = fs[0]; info.textContent = file.name + ' · ' + PL.fmtBytes(file.size); sync(); res.style.display = 'none'; out.innerHTML = ''; }, '.pdf,application/pdf', false);
    root.appendChild(dz);
    const info = PL.el('div', 'log'); root.appendChild(info);

    /* ── add ── */
    const addBox = PL.el('div');
    const F = PL.buildFields(PL.ops.watermark.fields);
    addBox.appendChild(F.el);
    const rec = PL.el('div', 'ctl');
    rec.innerHTML = '<div class="field wide" id="w_recbox"><label for="w_rec">One copy per recipient (optional — one name or ID per line, max 200)</label><textarea id="w_rec" rows="4" spellcheck="false" placeholder="alice@example.com&#10;Bob (Finance)&#10;vendor-17"></textarea></div>';
    addBox.appendChild(rec);
    const note = PL.el('div', 'note');
    note.innerHTML = '<b>Invisible mark:</b> hidden in the file’s information and as invisible text on every page, so you can later check which copy a file came from. It survives copying and renaming; <b>printing, screenshots or “print to PDF” remove it</b>, so treat it as a lead, not proof. Use it only on documents you own, and tell recipients that copies are individually marked.';
    addBox.appendChild(note);
    root.appendChild(addBox);

    /* ── check ── */
    const chkBox = PL.el('div');
    chkBox.appendChild(PL.el('div', 'note', 'Drop a PDF to see whether it carries a Patram invisible mark and which tag it holds. Only files marked by Patram can be read.'));
    root.appendChild(chkBox);

    const actions = PL.el('div', 'actions');
    const go = PL.el('button', 'btn', 'Apply watermark'); go.disabled = true;
    const stop = PL.el('button', 'btn ghost', 'Cancel'); stop.style.display = 'none';
    actions.append(go, stop); root.appendChild(actions);
    const log = PL.logger(root);
    const res = PL.el('div', 'result'); res.style.display = 'none'; root.appendChild(res);
    const out = PL.el('div', 'out'); root.appendChild(out);

    function modeHasInvisible() { return F.values().mode !== 'visible'; }
    function sync() {
      F.sync();
      rec.style.display = tab === 'add' && modeHasInvisible() ? '' : 'none';
      go.disabled = !file || running;
    }
    F.inputs.mode.addEventListener('change', sync);
    function setTab(v) {
      tab = v;
      tabs.querySelectorAll('.chip').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      addBox.style.display = v === 'add' ? '' : 'none'; chkBox.style.display = v === 'check' ? '' : 'none';
      go.textContent = v === 'add' ? 'Apply watermark' : 'Check for mark';
      res.style.display = 'none'; out.innerHTML = ''; log.set('');
      sync();
    }

    go.onclick = async () => {
      running = true; ac = new AbortController(); go.disabled = true; stop.style.display = ''; out.innerHTML = ''; res.style.display = 'none';
      PL.busy = () => running; PL.cleanup = () => ac.abort();
      try {
        const buf = new Uint8Array(await PL.readArrayBuffer(file));
        const stem = file.name.replace(/\.pdf$/i, '');
        if (tab === 'check') {
          log.set('Reading…');
          const r = await PL.mark.detect(buf, { signal: ac.signal });
          res.style.display = ''; res.className = 'result ' + ((r.info || r.tags.length) ? 'good' : 'warn');
          res.innerHTML = '<div class="rsz"><b class="to"></b></div><div class="rnote"></div><ul class="issues"></ul>';
          const ul = res.querySelector('.issues'), li = t => { const e = PL.el('li'); e.textContent = t; ul.appendChild(e); };
          if (!r.info && !r.tags.length) {
            res.querySelector('.to').textContent = 'No Patram mark found';
            res.querySelector('.rnote').textContent = 'The file is unmarked, or the mark was removed (printing, rasterising or a metadata-stripping tool).';
          } else {
            res.querySelector('.to').textContent = 'Marked: ' + (r.tags.map(t => t.tag).join(', ') || r.info);
            res.querySelector('.rnote').textContent = 'Found on ' + r.marked + ' of ' + r.total + ' page' + (r.total === 1 ? '' : 's') + (r.info ? ' · also in document information' : ' · document information entry is missing');
            if (r.tags.length > 1) li('More than one tag is present — pages were combined from differently marked copies.');
            if (r.info && r.tags.length && !r.tags.some(t => t.tag === r.info)) li('The information entry (“' + r.info + '”) does not match the page marks — the file was edited.');
            if (r.marked && r.marked < r.total) li((r.total - r.marked) + ' page(s) carry no mark — pages were added, replaced or flattened.');
            if (r.bad) li(r.bad + ' mark(s) failed their checksum — partially damaged.');
          }
          log.set('Done.', 'ok');
        } else {
          const base = F.values();
          const names = modeHasInvisible() ? root.querySelector('#w_rec').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean) : [];
          if (names.length > 200) throw new Error('Too many recipients (max 200)');
          if (names.length) {
            const files = {}, rows = ['recipient,tag,file']; const used = new Set();
            for (let i = 0; i < names.length; i++) {
              log.set('Marking copy ' + (i + 1) + ' of ' + names.length + '…');
              const r = await PL.ops.watermark.run(buf, { ...base, tag: names[i], lenient: true }, { signal: ac.signal, name: file.name });
              let fn = stem + '-' + PL.mark.safeName(names[i]) + '.pdf', k = 2;
              while (used.has(fn)) fn = stem + '-' + PL.mark.safeName(names[i]) + '-' + (k++) + '.pdf';
              used.add(fn); files[fn] = [r.bytes, { level: 0 }];
              rows.push([names[i], r.tag, fn].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
              await PL.tick();
            }
            files['recipients.csv'] = [new TextEncoder().encode(rows.join('\n') + '\n'), { level: 0 }];
            out.appendChild(PL.download(window.fflate.zipSync(files), stem + '-marked-copies.zip', 'application/zip'));
            log.set('Done — ' + names.length + ' individually marked copies in the ZIP (recipients.csv maps each name to its file).', 'ok');
          } else {
            log.set('Stamping…');
            const r = await PL.ops.watermark.run(buf, { ...base, lenient: true }, { signal: ac.signal, name: file.name });
            out.appendChild(PL.download(r.bytes, stem + '-watermarked.pdf'));
            log.set('Done.' + (r.tag ? ' Invisible tag: “' + r.tag + '”.' : ''), 'ok');
          }
        }
      } catch (e) { log.set(e && e.name === 'AbortError' ? 'Cancelled.' : 'Failed: ' + PL.friendlyError(e), 'err'); }
      running = false; stop.style.display = 'none'; go.disabled = !file; PL.busy = null; PL.cleanup = null;
    };
    stop.onclick = () => { if (ac) ac.abort(); log.set('Cancelling…'); };
    setTab('add');
  });
})(window.PaperLab);
