const API = window.browserAPI;

// ── Elementos da UI ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const tabsEl           = $('tabs');
const webviewsEl       = $('webviews');
const urlBar           = $('url-bar');
const urlSecure        = $('url-secure');
const btnBack          = $('btn-back');
const btnForward       = $('btn-forward');
const btnReload        = $('btn-reload');
const btnHome          = $('btn-home');
const btnBookmark      = $('btn-bookmark');
const btnNewTab        = $('btn-new-tab');
const btnMenu          = $('btn-menu');
const loadingInd       = $('loading-indicator');
const bookmarksBar     = $('bookmarks-bar');
const appMenu          = $('app-menu');
const zoomLevelEl      = $('zoom-level');
const urlSuggestionsEl = $('url-suggestions');
const newtabOverlay    = $('newtab-overlay');
const newtabSearch     = $('newtab-search');
const newtabBookmarks  = $('newtab-bookmarks');
const newtabRecent     = $('newtab-recent');
const downloadBar        = $('download-bar');
const downloadItemsEl    = $('download-items');
const downloadsOverlay   = $('downloads-overlay');
const downloadsListEl    = $('downloads-list');
// Find bar
const findBar    = $('find-bar');
const findInput  = $('find-input');
const findCount  = $('find-count');
// History overlay
const historyOverlay = $('history-overlay');
const historyList    = $('history-list');
const historySearch  = $('history-search');

// ── Estado ──────────────────────────────────────────────────────────────
let HOME_PAGE = 'https://www.google.com';
const tabs = [];           // { id, webview, tabEl, url, title, loading, isNewTab }
let activeTabId = null;
let tabSeq = 0;
const closedTabs = [];     // pilha de URLs de abas fechadas (para reabrir)
const activeDownloads = new Map();

// ── Utilidades de URL ───────────────────────────────────────────────────
function parseInput(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  const looksLikeURL =
    /^https?:\/\//i.test(trimmed) ||
    /^file:\/\//i.test(trimmed) ||
    /^about:/i.test(trimmed) ||
    /^[\w-]+\.[\w.-]+/.test(trimmed) ||
    trimmed === 'localhost' || trimmed.startsWith('localhost:');
  if (looksLikeURL) {
    return /^[a-z]+:\/\//i.test(trimmed) || trimmed.startsWith('about:')
      ? trimmed : `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function prettifySecure(url) {
  if (url.startsWith('https://')) { urlSecure.textContent = '\u{1F512}'; urlSecure.title = 'Conexão segura (HTTPS)'; }
  else if (url.startsWith('http://')) { urlSecure.textContent = '⚠'; urlSecure.title = 'Conexão não segura (HTTP)'; }
  else { urlSecure.textContent = '\u{1F4C4}'; urlSecure.title = ''; }
}

// ── Sessão — save com debounce ──────────────────────────────────────────
let _saveSessionTimer = null;
function saveSession() {
  clearTimeout(_saveSessionTimer);
  _saveSessionTimer = setTimeout(() => {
    const data = tabs
      .map((t) => ({ url: t.url, title: t.title }))
      .filter((t) => t.url && !/^about:/.test(t.url));
    API.session.save({ tabs: data });
  }, 800);
}

// ── Gerenciamento de abas ───────────────────────────────────────────────
function getTab(id) { return tabs.find((t) => t.id === id); }
function activeTab() { return getTab(activeTabId); }

function createTab(url = '', { activate = true } = {}) {
  const id = ++tabSeq;
  const isNewTab = !url || url === 'about:blank';
  const src = isNewTab ? 'about:blank' : (parseInput(url) || 'about:blank');

  // Webview
  const wv = document.createElement('webview');
  wv.setAttribute('src', src);
  wv.setAttribute('partition', 'persist:main');
  wv.setAttribute('allowpopups', '');
  wv.dataset.tabId = String(id);
  webviewsEl.appendChild(wv);

  // Aba (UI)
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `
    <img class="tab-favicon" alt="" />
    <span class="tab-title">Nova aba</span>
    <button class="tab-close" title="Fechar aba">&#10005;</button>`;
  tabsEl.appendChild(tabEl);

  const tab = { id, webview: wv, tabEl, url: '', title: 'Nova aba', loading: false, isNewTab };
  tabs.push(tab);

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) { closeTab(id); return; }
    activateTab(id);
  });
  tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });

  wireWebview(tab);
  if (activate) activateTab(id);
  return tab;
}

function activateTab(id) {
  const tab = getTab(id);
  if (!tab) return;
  activeTabId = id;
  for (const t of tabs) {
    const on = t.id === id;
    t.webview.classList.toggle('active', on);
    t.tabEl.classList.toggle('active', on);
  }
  syncToolbar(tab);
  closeFind();
  if (tab.isNewTab) showNewtab();
  else hideNewtab();
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (tab.url) closedTabs.push(tab.url);

  tab.webview.remove();
  tab.tabEl.remove();
  tabs.splice(idx, 1);

  if (tabs.length === 0) { createTab(); return; }
  if (activeTabId === id) {
    activateTab(tabs[Math.min(idx, tabs.length - 1)].id);
  }
  saveSession();
}

function reopenClosedTab() {
  const url = closedTabs.pop();
  createTab(url || '');
}

function selectTabByIndex(which) {
  if (tabs.length === 0) return;
  const tab = which === 'last' ? tabs[tabs.length - 1] : tabs[which];
  if (tab) activateTab(tab.id);
}

function cycleTab(dir) {
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  if (idx === -1) return;
  activateTab(tabs[(idx + dir + tabs.length) % tabs.length].id);
}

// ── Eventos de cada webview ─────────────────────────────────────────────
function wireWebview(tab) {
  const wv = tab.webview;
  const isActive = () => tab.id === activeTabId;

  const onNavigate = async (url) => {
    tab.url = url;
    tab.isNewTab = false;
    saveSession();
    if (isActive()) {
      hideNewtab();
      urlBar.value = url;
      prettifySecure(url);
      updateNavButtons();
      refreshBookmarkStar();
      hideSuggestions();
      // Aplicar zoom salvo para este hostname
      try {
        const hostname = new URL(url).hostname;
        if (hostname) {
          const saved = await API.zoom.get(hostname);
          wv.setZoomLevel(saved ?? 0);
          updateZoomLabel();
        }
      } catch (_) {}
    }
  };

  wv.addEventListener('did-navigate', (e) => onNavigate(e.url));
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) onNavigate(e.url); });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.url || 'Nova aba';
    tab.tabEl.querySelector('.tab-title').textContent = tab.title;
    tab.tabEl.title = tab.title;
    if (isActive()) document.title = `${tab.title} — Certix`;
  });

  wv.addEventListener('page-favicon-updated', (e) => {
    const icon = e.favicons && e.favicons[0];
    const img = tab.tabEl.querySelector('.tab-favicon');
    if (icon) { img.src = icon; img.style.visibility = 'visible'; }
  });

  wv.addEventListener('did-start-loading', () => {
    tab.loading = true;
    tab.tabEl.classList.add('loading');
    if (isActive()) setLoading(true);
  });

  wv.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    tab.tabEl.classList.remove('loading');
    if (isActive()) { setLoading(false); updateNavButtons(); }
    const url = wv.getURL();
    if (url && /^https?:/.test(url)) API.history.add(url, wv.getTitle());
  });

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;
    console.error(`[WebView] Falha: ${e.errorDescription} (${e.errorCode}) ${e.validatedURL}`);
  });

  wv.addEventListener('found-in-page', (e) => {
    const r = e.result;
    findCount.textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : '0/0';
  });
}

// ── Sincronização da toolbar ────────────────────────────────────────────
function syncToolbar(tab) {
  urlBar.value = tab.url || '';
  prettifySecure(tab.url || '');
  document.title = tab.title ? `${tab.title} — Certix` : 'Certix';
  setLoading(tab.loading);
  updateNavButtons();
  refreshBookmarkStar();
  updateZoomLabel();
}

function setLoading(on) {
  loadingInd.classList.toggle('loading', on);
  btnReload.innerHTML = on ? '&#10005;' : '&#8635;';
  btnReload.title = on ? 'Parar' : 'Recarregar (Ctrl+R)';
}

function updateNavButtons() {
  const wv = activeTab()?.webview;
  btnBack.disabled = !wv || !wv.canGoBack();
  btnForward.disabled = !wv || !wv.canGoForward();
}

function navigateActive(input) {
  const url = parseInput(input);
  const wv = activeTab()?.webview;
  if (url && wv) {
    hideNewtab();
    wv.loadURL(url).catch(() => { wv.src = url; });
  }
}

// ── Nova aba (overlay) ──────────────────────────────────────────────────
function showNewtab() {
  newtabOverlay.hidden = false;
  loadNewtabContent();
  setTimeout(() => newtabSearch?.focus(), 50);
}

function hideNewtab() {
  newtabOverlay.hidden = true;
}

async function loadNewtabContent() {
  const [bookmarkList, recentList] = await Promise.all([
    API.bookmarks.list(),
    API.history.list(10),
  ]);

  newtabBookmarks.innerHTML = '';
  for (const b of bookmarkList.slice(0, 8)) {
    const el = document.createElement('a');
    el.className = 'newtab-shortcut';
    el.href = '#';
    const initials = (b.title || b.url).replace(/^https?:\/\//, '').slice(0, 2).toUpperCase();
    el.innerHTML = `<span class="shortcut-icon"></span><span class="shortcut-label"></span>`;
    el.querySelector('.shortcut-icon').textContent = initials;
    el.querySelector('.shortcut-label').textContent = b.title || b.url;
    el.addEventListener('click', (e) => { e.preventDefault(); navigateActive(b.url); hideNewtab(); });
    newtabBookmarks.appendChild(el);
  }
  if (!bookmarkList.length) {
    newtabBookmarks.innerHTML = '<span style="font-size:12px;color:#4a5568">Nenhum favorito ainda.</span>';
  }

  newtabRecent.innerHTML = '';
  for (const h of recentList.slice(0, 6)) {
    const el = document.createElement('a');
    el.className = 'newtab-recent-item';
    el.href = '#';
    el.innerHTML = `<span class="recent-title"></span><span class="recent-url"></span>`;
    el.querySelector('.recent-title').textContent = h.title || h.url;
    el.querySelector('.recent-url').textContent = h.url;
    el.addEventListener('click', (e) => { e.preventDefault(); navigateActive(h.url); hideNewtab(); });
    newtabRecent.appendChild(el);
  }
  if (!recentList.length) {
    newtabRecent.innerHTML = '<span style="font-size:12px;color:#4a5568">Nenhuma visita ainda.</span>';
  }
}

newtabSearch?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const val = newtabSearch.value.trim();
    if (val) { navigateActive(val); hideNewtab(); }
  }
  if (e.key === 'Escape') hideNewtab();
});

// ── Autocomplete da barra de URL ────────────────────────────────────────
let _suggestTimer = null;

function hideSuggestions() {
  urlSuggestionsEl.hidden = true;
  urlSuggestionsEl.innerHTML = '';
}

function positionSuggestions() {
  const rect = urlBar.getBoundingClientRect();
  const appRect = document.getElementById('app').getBoundingClientRect();
  urlSuggestionsEl.style.left  = (rect.left  - appRect.left) + 'px';
  urlSuggestionsEl.style.width = rect.width + 'px';
  urlSuggestionsEl.style.top   = (rect.bottom - appRect.top + 4) + 'px';
}

function renderSuggestions(items) {
  if (!items.length) { hideSuggestions(); return; }
  urlSuggestionsEl.innerHTML = '';
  positionSuggestions();
  urlSuggestionsEl.hidden = false;
  for (const item of items.slice(0, 8)) {
    const el = document.createElement('div');
    el.className = 'suggestion-item';
    el.innerHTML = `<span class="sug-title"></span><span class="sug-url"></span>`;
    el.querySelector('.sug-title').textContent = item.title || item.url;
    el.querySelector('.sug-url').textContent = item.url;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // evitar blur antes do click
      navigateActive(item.url);
      urlBar.blur();
      hideSuggestions();
    });
    urlSuggestionsEl.appendChild(el);
  }
}

urlBar.addEventListener('input', () => {
  clearTimeout(_suggestTimer);
  const q = urlBar.value.trim();
  if (!q) { hideSuggestions(); return; }
  _suggestTimer = setTimeout(async () => {
    const [histResults, allBookmarks] = await Promise.all([
      API.history.search(q),
      API.bookmarks.list(),
    ]);
    const ql = q.toLowerCase();
    const bookFiltered = allBookmarks.filter(
      (b) => b.url.toLowerCase().includes(ql) || (b.title || '').toLowerCase().includes(ql),
    );
    const seen = new Set();
    const combined = [];
    for (const item of [...bookFiltered, ...histResults]) {
      if (!seen.has(item.url)) { seen.add(item.url); combined.push(item); }
    }
    renderSuggestions(combined);
  }, 150);
});

urlBar.addEventListener('blur', () => {
  setTimeout(() => hideSuggestions(), 200);
});

// ── Favoritos ───────────────────────────────────────────────────────────
async function refreshBookmarkStar() {
  const url = activeTab()?.url;
  if (!url) { btnBookmark.classList.remove('active'); btnBookmark.innerHTML = '&#9734;'; return; }
  const has = await API.bookmarks.has(url);
  btnBookmark.classList.toggle('active', has);
  btnBookmark.innerHTML = has ? '&#9733;' : '&#9734;';
}

async function toggleBookmark() {
  const tab = activeTab();
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) return;
  await API.bookmarks.toggle(tab.url, tab.title);
  await refreshBookmarkStar();
  await renderBookmarksBar();
}

async function renderBookmarksBar() {
  const list = await API.bookmarks.list();
  bookmarksBar.innerHTML = '';
  if (list.length === 0) { bookmarksBar.classList.add('empty'); return; }
  bookmarksBar.classList.remove('empty');
  for (const b of list) {
    const el = document.createElement('button');
    el.className = 'bookmark';
    el.title = `${b.title}\n${b.url}`;
    el.textContent = b.title.length > 28 ? b.title.slice(0, 28) + '…' : b.title;
    el.addEventListener('click', () => navigateActive(b.url));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) createTab(b.url, { activate: false }); });
    el.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      await API.bookmarks.remove(b.url);
      await renderBookmarksBar();
      refreshBookmarkStar();
    });
    bookmarksBar.appendChild(el);
  }
}

// ── Histórico (overlay) ─────────────────────────────────────────────────
async function openHistory() {
  historyOverlay.hidden = false;
  historySearch.value = '';
  await renderHistory(await API.history.list(500));
  historySearch.focus();
}
function closeHistory() { historyOverlay.hidden = true; }

async function renderHistory(entries) {
  historyList.innerHTML = '';
  if (!entries.length) {
    historyList.innerHTML = '<div class="history-empty">Nenhuma entrada no histórico.</div>';
    return;
  }
  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const date = new Date(e.visitedAt);
    const time = date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `
      <span class="history-time">${time}</span>
      <span class="history-title"></span>
      <span class="history-url"></span>
      <button class="history-del" title="Remover">&#10005;</button>`;
    row.querySelector('.history-title').textContent = e.title || e.url;
    row.querySelector('.history-url').textContent = e.url;
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('.history-del')) return;
      navigateActive(e.url); closeHistory();
    });
    row.querySelector('.history-del').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await API.history.remove(e.url);
      row.remove();
    });
    historyList.appendChild(row);
  }
}

// ── Busca na página (find-in-page) ──────────────────────────────────────
function openFind() {
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
}
function closeFind() {
  findBar.hidden = true;
  findCount.textContent = '0/0';
  activeTab()?.webview.stopFindInPage('clearSelection');
}
function doFind(forward = true) {
  const text = findInput.value;
  const wv = activeTab()?.webview;
  if (!wv) return;
  if (!text) { wv.stopFindInPage('clearSelection'); findCount.textContent = '0/0'; return; }
  wv.findInPage(text, { forward, findNext: true });
}

// ── Zoom ────────────────────────────────────────────────────────────────
async function setZoom(delta) {
  const wv = activeTab()?.webview;
  if (!wv) return;
  if (delta === 0) wv.setZoomLevel(0);
  else wv.setZoomLevel(wv.getZoomLevel() + delta);
  updateZoomLabel();
  const url = activeTab()?.url;
  if (url && /^https?:/.test(url)) {
    try {
      const hostname = new URL(url).hostname;
      if (hostname) await API.zoom.set(hostname, wv.getZoomLevel());
    } catch (_) {}
  }
}

function updateZoomLabel() {
  const wv = activeTab()?.webview;
  if (!wv) return;
  const pct = Math.round(Math.pow(1.2, wv.getZoomLevel()) * 100);
  zoomLevelEl.textContent = `${pct}%`;
}

// ── Downloads — overlay ─────────────────────────────────────────────────
function openDownloads() {
  downloadsOverlay.hidden = false;
  renderDownloadsOverlay();
}
function closeDownloads() { downloadsOverlay.hidden = true; }

function renderDownloadsOverlay() {
  downloadsListEl.innerHTML = '';
  if (activeDownloads.size === 0) {
    downloadsListEl.innerHTML = '<div class="downloads-empty">Nenhum download nesta sessão.</div>';
    return;
  }
  for (const [id, dl] of [...activeDownloads.entries()].reverse()) {
    const isActive = dl.state === 'progressing';
    const isDone   = dl.state === 'completed';
    const isFailed = !isActive && !isDone;
    const pct      = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'dl-row';
    row.dataset.dlId = id;

    let progressHtml = '';
    if (isActive) {
      progressHtml = `
        <div class="dl-row-progresswrap"><div class="dl-row-progressbar" style="width:${pct}%"></div></div>
        <span class="dl-row-pct">${pct}%</span>`;
    } else if (isDone) {
      progressHtml = `<span class="dl-row-status ok">Concluído</span>`;
    } else {
      progressHtml = `<span class="dl-row-status err">Falhou</span>`;
    }

    row.innerHTML = `
      <div class="dl-row-icon">${isDone ? '✅' : isFailed ? '❌' : '⬇️'}</div>
      <div class="dl-row-info">
        <span class="dl-row-name"></span>
        <span class="dl-row-path"></span>
        <div class="dl-row-bottom">
          ${progressHtml}
          ${dl.total > 0 ? `<span class="dl-row-size">${(dl.total/1024/1024).toFixed(1)} MB</span>` : ''}
        </div>
      </div>
      <div class="dl-row-actions">
        ${isDone ? `<button class="dl-act dl-act-open">Abrir</button>` : ''}
        <button class="dl-act dl-act-remove" title="Remover da lista">&#10005;</button>
      </div>`;

    row.querySelector('.dl-row-name').textContent = dl.filename;
    row.querySelector('.dl-row-path').textContent = dl.savePath;
    if (isDone) {
      row.querySelector('.dl-act-open').addEventListener('click', () => API.downloads.openFile(dl.savePath));
    }
    row.querySelector('.dl-act-remove').addEventListener('click', () => {
      activeDownloads.delete(id);
      row.remove();
      if (activeDownloads.size === 0) {
        downloadsListEl.innerHTML = '<div class="downloads-empty">Nenhum download nesta sessão.</div>';
        downloadBar.hidden = true;
      } else {
        renderDownloads();
      }
    });
    downloadsListEl.appendChild(row);
  }
}

$('downloads-close').addEventListener('click', closeDownloads);
$('downloads-clear').addEventListener('click', () => {
  for (const [id, dl] of activeDownloads) {
    if (dl.state !== 'progressing') activeDownloads.delete(id);
  }
  if (activeDownloads.size === 0) downloadBar.hidden = true;
  else renderDownloads();
  renderDownloadsOverlay();
});
downloadsOverlay.addEventListener('click', (e) => { if (e.target === downloadsOverlay) closeDownloads(); });

// ── Downloads — barra inferior ───────────────────────────────────────────
function renderDownloads() {
  downloadItemsEl.innerHTML = '';
  for (const [id, dl] of [...activeDownloads.entries()].reverse()) {
    const el = document.createElement('div');
    el.className = 'download-item';
    const pct = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0;
    const isDone   = dl.state === 'completed';
    const isFailed = dl.state === 'interrupted' || dl.state === 'cancelled';
    el.innerHTML = `
      <span class="dl-name"></span>
      ${isDone || isFailed ? '' : `<div class="dl-progress"><div class="dl-bar" style="width:${pct}%"></div></div>`}
      <span class="dl-status">${isDone ? 'Concluído' : isFailed ? 'Falhou' : `${pct}%`}</span>
      ${isDone ? `<button class="dl-open">Abrir</button>` : ''}
      <button class="dl-dismiss">&#10005;</button>`;
    el.querySelector('.dl-name').textContent = dl.filename;
    el.querySelector('.dl-name').title = dl.savePath;
    if (isDone) {
      el.querySelector('.dl-open').addEventListener('click', () => API.downloads.openFile(dl.savePath));
    }
    el.querySelector('.dl-dismiss').addEventListener('click', () => {
      activeDownloads.delete(id);
      if (activeDownloads.size === 0) downloadBar.hidden = true;
      else renderDownloads();
    });
    downloadItemsEl.appendChild(el);
  }
}

API.downloads.onStart((d) => {
  activeDownloads.set(d.id, { ...d, received: 0, state: 'progressing' });
  downloadBar.hidden = false;
  renderDownloads();
  if (!downloadsOverlay.hidden) renderDownloadsOverlay();
});
API.downloads.onProgress((d) => {
  const dl = activeDownloads.get(d.id);
  if (dl) { dl.received = d.received; dl.total = d.total; }
  renderDownloads();
  if (!downloadsOverlay.hidden) renderDownloadsOverlay();
});
API.downloads.onDone((d) => {
  const dl = activeDownloads.get(d.id);
  if (dl) { dl.state = d.state; dl.savePath = d.savePath; }
  renderDownloads();
  if (!downloadsOverlay.hidden) renderDownloadsOverlay();
});

$('download-bar-close').addEventListener('click', () => {
  activeDownloads.clear();
  downloadBar.hidden = true;
});

// ── Menu suspenso (botão ⋮) ─────────────────────────────────────────────
function toggleAppMenu(force) {
  const show = force !== undefined ? force : appMenu.hidden;
  appMenu.hidden = !show;
}
document.addEventListener('click', (e) => {
  if (!appMenu.hidden && !appMenu.contains(e.target) && e.target !== btnMenu) toggleAppMenu(false);
});
appMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-action]');
  if (!item) return;
  handleAction(item.dataset.action);
  if (!item.classList.contains('zoom-btn')) toggleAppMenu(false);
});

// ── Roteador de ações (menu nativo + ⋮ + botões) ────────────────────────
function handleAction(action, arg) {
  const wv = activeTab()?.webview;
  switch (action) {
    case 'new-tab':           createTab(); break;
    case 'close-tab':         closeTab(activeTabId); break;
    case 'reopen-tab':        reopenClosedTab(); break;
    case 'open-url-newtab':   createTab(arg); break;
    case 'select-tab':        selectTabByIndex(arg); break;
    case 'next-tab':          cycleTab(1); break;
    case 'prev-tab':          cycleTab(-1); break;
    case 'focus-url':         urlBar.focus(); urlBar.select(); break;
    case 'reload':            wv?.reload(); break;
    case 'reload-hard':       wv?.reloadIgnoringCache(); break;
    case 'back':              if (wv?.canGoBack()) wv.goBack(); break;
    case 'forward':           if (wv?.canGoForward()) wv.goForward(); break;
    case 'home':              navigateActive(HOME_PAGE); break;
    case 'bookmark':          toggleBookmark(); break;
    case 'toggle-bookmarks-bar': bookmarksBar.classList.toggle('hidden'); break;
    case 'history':           historyOverlay.hidden ? openHistory() : closeHistory(); break;
    case 'downloads':         downloadsOverlay.hidden ? openDownloads() : closeDownloads(); break;
    case 'find':              openFind(); break;
    case 'zoom-in':           setZoom(0.5); break;
    case 'zoom-out':          setZoom(-0.5); break;
    case 'zoom-reset':        setZoom(0); break;
    case 'print':             wv?.print(); break;
    case 'devtools':
      if (wv) wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools();
      break;
  }
}

// ── Listeners de botões/inputs ──────────────────────────────────────────
urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    hideSuggestions();
    navigateActive(urlBar.value);
    activeTab()?.webview.focus();
  } else if (e.key === 'Escape') {
    urlBar.value = activeTab()?.url || '';
    urlBar.blur();
    hideSuggestions();
  }
});
urlBar.addEventListener('focus', () => urlBar.select());

btnBack.addEventListener('click', () => handleAction('back'));
btnForward.addEventListener('click', () => handleAction('forward'));
btnReload.addEventListener('click', () => {
  const wv = activeTab()?.webview;
  if (wv) wv.isLoading() ? wv.stop() : wv.reload();
});
btnHome.addEventListener('click', () => handleAction('home'));
btnBookmark.addEventListener('click', () => toggleBookmark());
btnNewTab.addEventListener('click', () => createTab());
btnMenu.addEventListener('click', (e) => { e.stopPropagation(); updateZoomLabel(); toggleAppMenu(); });

// Find bar
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doFind(!e.shiftKey);
  else if (e.key === 'Escape') closeFind();
});
findInput.addEventListener('input', () => doFind(true));
$('find-next').addEventListener('click', () => doFind(true));
$('find-prev').addEventListener('click', () => doFind(false));
$('find-close').addEventListener('click', () => closeFind());

// History overlay
$('history-close').addEventListener('click', () => closeHistory());
$('history-clear').addEventListener('click', async () => { await API.history.clear(); renderHistory([]); });
historySearch.addEventListener('input', async () => {
  const q = historySearch.value.trim();
  renderHistory(q ? await API.history.search(q) : await API.history.list(500));
});
historyOverlay.addEventListener('click', (e) => { if (e.target === historyOverlay) closeHistory(); });

// ── Controles de janela (frameless) ─────────────────────────────────────
const winMax    = $('win-max');
const icoMax    = winMax.querySelector('.ico-max');
const icoRestore = winMax.querySelector('.ico-restore');

function setMaxIcon(isMax) {
  icoMax.hidden = isMax;
  icoRestore.hidden = !isMax;
  winMax.title = isMax ? 'Restaurar' : 'Maximizar';
}

$('win-min').addEventListener('click', () => API.window.minimize());
winMax.addEventListener('click', () => API.window.toggleMaximize());
$('win-close').addEventListener('click', () => API.window.close());
$('drag-spacer').addEventListener('dblclick', () => API.window.toggleMaximize());
API.window.onMaximizeChange(setMaxIcon);

// Ações vindas do Menu nativo / atalhos (main process)
API.onMenuAction((action, ...args) => handleAction(action, args[0]));

// Fallback Escape global
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!appMenu.hidden) toggleAppMenu(false);
    else if (!downloadsOverlay.hidden) closeDownloads();
    else if (!historyOverlay.hidden) closeHistory();
    else if (!findBar.hidden) closeFind();
    else if (!newtabOverlay.hidden) hideNewtab();
  }
});

// ── Inicialização ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  HOME_PAGE = await API.getHomePage();
  setMaxIcon(await API.window.isMaximized());
  await renderBookmarksBar();

  // Sempre abre a home page como primeira aba ativa
  createTab(HOME_PAGE);

  // Restaura abas da sessão anterior como tabs em background
  const saved = await API.session.load();
  if (saved && Array.isArray(saved.tabs)) {
    for (const t of saved.tabs) {
      if (t.url && t.url !== HOME_PAGE) {
        createTab(t.url, { activate: false });
      }
    }
  }
});
