const certListEl  = document.getElementById('cert-list');
const certDetails = document.getElementById('cert-details');
const siteUrl     = document.getElementById('site-url');
const btnOk       = document.getElementById('btn-ok');
const btnCancel   = document.getElementById('btn-cancel');
const noSelMsg    = document.getElementById('no-selection-msg');

let selectedIndex = -1;
let certs = [];

// ---------------------------------------------------------------------------
// Receber lista de certificados do main process
// ---------------------------------------------------------------------------
window.certAPI.onCertList(({ url, list, recent = [] }) => {
  certs = list;
  siteUrl.textContent = url;
  certListEl.innerHTML = '';

  if (list.length === 0) {
    certListEl.innerHTML = `
      <div id="empty-state">
        <span class="empty-icon">📭</span>
        <p>Nenhum certificado encontrado para este site.</p>
      </div>`;
    return;
  }

  // Índices de certs que foram usados recentemente (na ordem de recência)
  const recentIndices = [];
  for (const r of recent) {
    const idx = list.findIndex((c) => c.fingerprint === r.fingerprint);
    if (idx !== -1 && !recentIndices.includes(idx)) recentIndices.push(idx);
  }

  if (recentIndices.length > 0) {
    appendSectionLabel('Recentes');
    for (const idx of recentIndices) {
      certListEl.appendChild(buildCertItem(list[idx], idx));
    }
    appendSectionLabel('Todos');
  }

  list.forEach((cert, i) => certListEl.appendChild(buildCertItem(cert, i)));
});

function appendSectionLabel(text) {
  const el = document.createElement('div');
  el.className = 'cert-section-label';
  el.textContent = text;
  certListEl.appendChild(el);
}

// ---------------------------------------------------------------------------
// Construir item de certificado
// ---------------------------------------------------------------------------
function buildCertItem(cert, i) {
  const item = document.createElement('div');
  item.className = 'cert-item';
  item.dataset.index = i;

  const expiry     = new Date(cert.validExpiry * 1000);
  const now        = new Date();
  const daysLeft   = Math.floor((expiry - now) / 86400000);
  const expiryClass = daysLeft < 0 ? 'expired' : daysLeft < 30 ? 'soon' : 'ok';
  const expiryText  = daysLeft < 0
    ? 'Expirado'
    : daysLeft === 0 ? 'Expira hoje'
    : `Expira em ${daysLeft} dia(s)`;

  item.innerHTML = `
    <div class="cert-name" title="${cert.subjectName}">${cert.subjectName || '(sem nome)'}</div>
    <div class="cert-meta">
      <span><span class="label">Emissor:</span> ${cert.issuerName || '—'}</span>
      <span class="cert-expiry ${expiryClass}">${expiryText}</span>
    </div>`;

  item.addEventListener('click', () => selectItem(i));
  item.addEventListener('dblclick', () => { selectItem(i); confirmSelection(); });
  return item;
}

// ---------------------------------------------------------------------------
// Seleção de item
// ---------------------------------------------------------------------------
function selectItem(index) {
  document.querySelectorAll('.cert-item').forEach((el) => el.classList.remove('selected'));
  selectedIndex = index;
  btnOk.disabled = false;
  const item = document.querySelector(`.cert-item[data-index="${index}"]`);
  if (item) item.classList.add('selected');
  showDetails(certs[index]);
}

function showDetails(cert) {
  if (!cert) {
    certDetails.innerHTML = '<span id="no-selection-msg">Selecione um certificado.</span>';
    return;
  }
  const expiry   = cert.validExpiry ? new Date(cert.validExpiry * 1000).toLocaleDateString('pt-BR') : '—';
  const validity = cert.validStart  ? new Date(cert.validStart  * 1000).toLocaleDateString('pt-BR') : '—';
  certDetails.innerHTML = `
    <div class="detail-row"><span class="detail-label">Titular:</span>   <span class="detail-value">${cert.subjectName  || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Emissor:</span>   <span class="detail-value">${cert.issuerName   || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Série:</span>     <span class="detail-value">${cert.serialNumber || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Válido de:</span> <span class="detail-value">${validity} até ${expiry}</span></div>
    <div class="detail-row"><span class="detail-label">SHA-1:</span>     <span class="detail-value">${cert.fingerprint  || '—'}</span></div>`;
}

// ---------------------------------------------------------------------------
// Botões e atalhos
// ---------------------------------------------------------------------------
function confirmSelection() {
  if (selectedIndex < 0) return;
  window.certAPI.selectCert(selectedIndex);
}

btnOk.addEventListener('click', confirmSelection);
btnCancel.addEventListener('click', () => window.certAPI.cancel());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.certAPI.cancel();
  if (e.key === 'Enter' && selectedIndex >= 0) confirmSelection();
  if (e.key === 'ArrowDown' && certs.length > 0) selectItem(Math.min(selectedIndex + 1, certs.length - 1));
  if (e.key === 'ArrowUp'   && certs.length > 0) selectItem(Math.max(selectedIndex - 1, 0));
});
