/* PaperLab — password protect / unlock PDFs (QPDF compiled to WebAssembly, runs entirely in the browser).
   Protect: AES-256 (or AES-128) encryption with an open-password and optional restrictions.
   Unlock : removes the password from a file — ONLY when you supply the correct password. PaperLab never guesses, cracks or
            brute-forces passwords. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const S = PL.secure = {};
  const V = '?v=20261020a';
  let factory = null, wasm = null;

  async function boot() {
    if (!factory) {
      if (!window.__plQpdf) { await PL.loadScript('vendor/qpdf/qpdf.js' + V); window.__plQpdf = window.Module; }
      factory = window.__plQpdf;
      if (typeof factory !== 'function') throw new Error('The encryption engine could not be loaded');
    }
    if (!wasm) {
      const r = await fetch('vendor/qpdf/qpdf.wasm' + V);
      if (!r.ok) throw new Error('The encryption engine could not be loaded (' + r.status + ')');
      wasm = await r.arrayBuffer();
    }
  }

  /* run qpdf once on `bytes` → { code, out, err, output: Uint8Array|null } (a fresh instance per run keeps memory bounded) */
  async function qpdf(args, bytes) {
    await boot();
    const out = [], err = [];
    const q = await factory({ wasmBinary: wasm.slice(0), noInitialRun: true, print: s => out.push(s), printErr: s => err.push(s) });
    let output = null, code = 0;
    try {
      q.FS.writeFile('/in.pdf', bytes);
      try { code = q.callMain(args); } catch (e) { code = (e && e.status != null) ? e.status : 2; if (!(e && e.status != null)) err.push(String(e && e.message || e)); }
      if (code === 0 || code === 3) { try { output = q.FS.readFile('/out.pdf'); } catch (e) { output = null; } }
    } finally { try { q.FS.unlink('/in.pdf'); } catch (e) { /* ignore */ } try { q.FS.unlink('/out.pdf'); } catch (e) { /* ignore */ } }
    return { code, out, err, output };
  }

  /* qpdf fails on some damaged files; PaperLab's repair engine usually reads them — repair, then retry once */
  async function qpdfOrRepair(args, bytes, ctx) {
    let r = await qpdf(args, bytes);
    if (r.output && r.output.length) return { r, repaired: false };
    if (isWrongPassword(r) && looksEncrypted(bytes)) return { r, repaired: false };
    if (!PL.repair || !PL.repair.repair) return { r, repaired: false };
    (ctx.progress || (() => {}))(0.4, 'repairing damaged file first');
    let fixed;
    try { fixed = await PL.repair.repair(bytes, { images: false }, { signal: ctx.signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Not a valid PDF (damaged or wrong file type)'); }
    r = await qpdf(args, fixed.bytes);
    return { r, repaired: !!(r.output && r.output.length) };
  }
  const looksEncrypted = u => {
    const dec = new TextDecoder('latin1'), tail = dec.decode(u.subarray(Math.max(0, u.length - 8192))), head = dec.decode(u.subarray(0, 4096));
    return /\/Encrypt\b/.test(tail) || /\/Encrypt\b/.test(head);
  };
  const isWrongPassword = r => /password/i.test(r.err.join(' ')) || (r.code === 2 && !r.output);

  /* → { encrypted, needsPassword } */
  S.inspect = async function (bytes) {
    if (!looksEncrypted(bytes)) return { encrypted: false, needsPassword: false };
    const r = await qpdf(['--decrypt', '/in.pdf', '/out.pdf'], bytes);
    return { encrypted: true, needsPassword: !(r.output && r.output.length) };
  };

  S.unlock = async function (bytes, o, ctx) {
    o = o || {}; ctx = ctx || {};
    PL.abortIf(ctx);
    if (!bytes || !bytes.length) throw new Error('Empty file (0 bytes)');
    if (!looksEncrypted(bytes)) {
      return { bytes: bytes.slice(), ext: 'pdf', note: 'Not password-protected — copied unchanged', skipped: false };
    }
    (ctx.progress || (() => {}))(0.2, 'removing password');
    const pw = String(o.password == null ? '' : o.password);
    const { r, repaired } = await qpdfOrRepair(['--password=' + pw, '--decrypt', '/in.pdf', '/out.pdf'], bytes, ctx);
    PL.abortIf(ctx);
    if (!r.output || !r.output.length) {
      if (isWrongPassword(r)) throw new Error(pw ? 'Wrong password' : 'This PDF needs a password to open — enter it to unlock');
      throw new Error('Could not unlock this PDF: ' + (r.err.join(' ').slice(0, 160) || 'unknown error'));
    }
    return { bytes: r.output, ext: 'pdf', note: (pw ? 'Password removed' : 'Restrictions removed (no open-password was set)') + (repaired ? ' · file was repaired first' : '') };
  };

  S.protect = async function (bytes, o, ctx) {
    o = o || {}; ctx = ctx || {};
    PL.abortIf(ctx);
    if (!bytes || !bytes.length) throw new Error('Empty file (0 bytes)');
    const user = String(o.password == null ? '' : o.password);
    if (!user) throw new Error('Enter a password');
    if (user.length > 127) throw new Error('Password is too long (max 127 characters)');
    if (looksEncrypted(bytes)) throw new Error('This PDF is already password-protected — unlock it first');
    const owner = String(o.owner || '') || user + '·owner';        // a distinct owner password, so restrictions hold even if the open-password is shared
    const bits = o.strength === '128' ? '128' : '256';
    const args = ['/in.pdf', '--encrypt', user, owner, bits];
    const print = ['full', 'low', 'none'].includes(o.print) ? o.print : 'full';
    args.push('--print=' + print, '--extract=' + (o.copy === false ? 'n' : 'y'), '--modify=' + (o.edit === false ? 'none' : 'all'));
    if (bits === '128') args.push('--use-aes=y');
    args.push('--', '/out.pdf');
    (ctx.progress || (() => {}))(0.2, 'encrypting');
    const { r, repaired } = await qpdfOrRepair(args, bytes, ctx);
    PL.abortIf(ctx);
    if (!r.output || !r.output.length) {
      throw new Error('Could not protect this PDF: ' + (r.err.join(' ').slice(0, 160) || 'the file may be damaged — try Repair first'));
    }
    return { bytes: r.output, ext: 'pdf', note: 'AES-' + bits + ' encrypted' + (print !== 'full' || o.copy === false || o.edit === false ? ' with restrictions' : '') + (repaired ? ' · file was repaired first' : '') };
  };

  /* ───────── shared operations (single tool + Mass Batch) ───────── */
  PL.ops = PL.ops || {};
  PL.ops.protect = {
    id: 'protect', label: 'Password-protect PDF', group: 'Security', accepts: ['pdf'], anyInput: true, suffix: '-protected', ext: 'pdf',
    fields: [
      { id: 'password', label: 'Password to open the file', type: 'password', value: '' },
      { id: 'owner', label: 'Owner password for the restrictions below (optional)', type: 'password', value: '' },
      { id: 'strength', label: 'Encryption', type: 'select', value: '256', options: [['256', 'AES-256 (recommended)'], ['128', 'AES-128 (very old readers)']] },
      { id: 'print', label: 'Printing', type: 'select', value: 'full', options: [['full', 'Allowed'], ['low', 'Low quality only'], ['none', 'Not allowed']] },
      { id: 'copy', label: 'Allow copying text', type: 'check', value: true },
      { id: 'edit', label: 'Allow editing', type: 'check', value: true }
    ],
    run(bytes, o, ctx) { return S.protect(bytes, o, ctx); }
  };
  PL.ops.unlock = {
    id: 'unlock', label: 'Unlock PDF (remove password)', group: 'Security', accepts: ['pdf'], anyInput: true, suffix: '-unlocked', ext: 'pdf',
    fields: [{ id: 'password', label: 'The PDF’s password (leave empty if it only has restrictions)', type: 'password', value: '' }],
    run(bytes, o, ctx) { return S.unlock(bytes, o, ctx); }
  };
})(window.PaperLab);
