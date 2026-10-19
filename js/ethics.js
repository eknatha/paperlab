/* PaperLab — responsible-use notices.
   Every tool opens with a short caution (always visible), the footer links to the full policy, and first-time visitors see a
   dismissible bar. Cautions are deliberately short; the policy page (responsible-use.html) has the detail. */
window.PaperLab = window.PaperLab || { tools: {} };

(function (PL) {
  const BASE = 'Use it only on files you own or are authorised to handle — never to forge, tamper with or misrepresent documents, or to bypass protections you have no right to remove.';
  const EXTRA = {
    watermark: 'Invisible marks are for tracing <b>your own</b> documents to the person you sent them to. Tell recipients their copy is individually marked — do not use marks to track people without their knowledge.',
    meta: 'Stripping metadata is fine for your own privacy. Do not use it to hide where a document came from, or to disguise that it was altered.',
    repair: 'Repair recovers <b>your own</b> damaged files. It does not bypass passwords or permissions, and recovered content should be checked before you rely on it.',
    books: 'Convert only books and comics you own or are licensed to use. PaperLab <b>refuses DRM-protected files</b> and will never remove DRM. Respect authors’ copyright.',
    searchable: 'Scans often contain personal data. Process only documents you are entitled to, and store the searchable output as carefully as the original.',
    compare: 'Compare only documents you are entitled to review. A difference report is a lead, not legal proof.',
    compress: 'Compression can reduce legibility. Check the result before submitting official or legal documents, and never change their content.',
    extract: 'Respect copyright and confidentiality when copying text out of documents.',
    numbers: 'Do not renumber or restamp pages to alter an official record or evidence.',
    batch: 'Batch runs touch <b>every</b> file you add — double-check the operation and keep the originals. Do not process other people’s files without permission.',
    organize: 'Do not reorder or remove pages to misrepresent a document.',
    split: 'Do not split or extract pages to misrepresent a document or share material you are not allowed to share.',
    merge: 'Do not combine documents to create a misleading or forged record.'
  };
  PL.caution = function (id) {
    const box = document.createElement('div');
    box.className = 'caution'; box.setAttribute('role', 'note');
    box.innerHTML = '<span class="cico" aria-hidden="true">⚠</span><div><b>Use responsibly.</b> ' + (EXTRA[id] ? EXTRA[id] + ' ' : '') + BASE +
      ' <a href="responsible-use.html" target="_blank" rel="noopener">Responsible-use policy</a></div>';
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
