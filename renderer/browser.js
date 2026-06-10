/**
 * Renderer — UI do browser com múltiplas abas, favoritos, histórico e atalhos.
 * Acessa o main process exclusivamente via window.browserAPI (preload.js).
 */

const API = window.browserAPI;

// ── Elementos da UI ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const tabsEl        = $('tabs');
const webviewsEl    = $('webviews');
const urlBar        = $('url-bar');
const urlSecure     = $('url-secure');
const btnBack       = $('btn-back');
const btnForward    = $('btn-forward');
const btnReload     = $('btn-reload');
const btnHome       = $('btn-home');
const btnBookmark   = $('btn-bookmark');
const btnNewTab     = $('btn-new-tab');
const btnMenu       = $('btn-menu');
const loadingInd    = $('loading-indicator');
const bookmarksBar  = $('bookmarks-bar');
const appMenu       = $('app-menu');
const zoomLevelEl   = $('zoom-level');
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
const tabs = [];           // { id, webview, tabEl, url, title, loading }
let activeTabId = null;
let tabSeq = 0;
const closedTabs = [];     // pilha de URLs de abas fechadas (para reabrir)

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

// ── Gerenciamento de abas ───────────────────────────────────────────────
function getTab(id) { return tabs.find((t) => t.id === id); }
function activeTab() { return getTab(activeTabId); }

function createTab(url = HOME_PAGE, { activate = true } = {}) {
  const id = ++tabSeq;

  // Webview
  const wv = document.createElement('webview');
  wv.setAttribute('src', parseInput(url) || HOME_PAGE);
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

  const tab = { id, webview: wv, tabEl, url: '', title: 'Nova aba', loading: false };
  tabs.push(tab);

  // Cliques na aba
  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) { closeTab(id); return; }
    activateTab(id);
  });
  tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); }); // botão do meio

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
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (tab.url) closedTabs.push(tab.url);

  tab.webview.remove();
  tab.tabEl.remove();
  tabs.splice(idx, 1);

  if (tabs.length === 0) { createTab(HOME_PAGE); return; }
  if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activateTab(next.id);
  }
}

function reopenClosedTab() {
  const url = closedTabs.pop();
  createTab(url || HOME_PAGE);
}

function selectTabByIndex(which) {
  if (tabs.length === 0) return;
  const tab = which === 'last' ? tabs[tabs.length - 1] : tabs[which];
  if (tab) activateTab(tab.id);
}

function cycleTab(dir) {
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  if (idx === -1) return;
  const next = (idx + dir + tabs.length) % tabs.length;
  activateTab(tabs[next].id);
}

// ── Eventos de cada webview ─────────────────────────────────────────────
function wireWebview(tab) {
  const wv = tab.webview;
  const isActive = () => tab.id === activeTabId;

  const onNavigate = (url) => {
    tab.url = url;
    if (isActive()) {
      urlBar.value = url;
      prettifySecure(url);
      updateNavButtons();
      refreshBookmarkStar();
    }
  };

  wv.addEventListener('did-navigate', (e) => onNavigate(e.url));
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) onNavigate(e.url); });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.url || 'Nova aba';
    tab.tabEl.querySelector('.tab-title').textContent = tab.title;
    tab.tabEl.title = tab.title;
    if (isActive()) document.title = `${tab.title} — CFBrowser`;
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
    // Registrar no histórico ao terminar de carregar (título já disponível).
    const url = wv.getURL();
    if (url && /^https?:/.test(url)) API.history.add(url, wv.getTitle());
  });

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return; // abortado pelo usuário
    console.error(`[WebView] Falha: ${e.errorDescription} (${e.errorCode}) ${e.validatedURL}`);
  });

  wv.addEventListener('found-in-page', (e) => {
    const r = e.result;
    findCount.textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : '0/0';
  });
}

// ── Sincronização da toolbar com a aba ativa ────────────────────────────
function syncToolbar(tab) {
  urlBar.value = tab.url || '';
  prettifySecure(tab.url || '');
  document.title = tab.title ? `${tab.title} — CFBrowser` : 'CFBrowser';
  setLoading(tab.loading);
  updateNavButtons();
  refreshBookmarkStar();
  updateZoomLabel();
}

function setLoading(on) {
  loadingInd.classList.toggle('loading', on);
  if (on) {
    btnReload.innerHTML = '&#10005;'; btnReload.title = 'Parar';
  } else {
    btnReload.innerHTML = '&#8635;'; btnReload.title = 'Recarregar (Ctrl+R)';
  }
}

function updateNavButtons() {
  const wv = activeTab()?.webview;
  btnBack.disabled = !wv || !wv.canGoBack();
  btnForward.disabled = !wv || !wv.canGoForward();
}

function navigateActive(input) {
  const url = parseInput(input);
  const wv = activeTab()?.webview;
  if (url && wv) wv.loadURL(url).catch(() => { wv.src = url; });
}

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
function setZoom(delta) {
  const wv = activeTab()?.webview;
  if (!wv) return;
  if (delta === 0) wv.setZoomLevel(0);
  else wv.setZoomLevel(wv.getZoomLevel() + delta);
  updateZoomLabel();
}
function updateZoomLabel() {
  const wv = activeTab()?.webview;
  if (!wv) return;
  const pct = Math.round(Math.pow(1.2, wv.getZoomLevel()) * 100);
  zoomLevelEl.textContent = `${pct}%`;
}

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
    case 'new-tab':       createTab(HOME_PAGE); break;
    case 'close-tab':     closeTab(activeTabId); break;
    case 'reopen-tab':    reopenClosedTab(); break;
    case 'open-url-newtab': createTab(arg); break;
    case 'select-tab':    selectTabByIndex(arg); break;
    case 'next-tab':      cycleTab(1); break;
    case 'prev-tab':      cycleTab(-1); break;
    case 'focus-url':     urlBar.focus(); urlBar.select(); break;
    case 'reload':        wv?.reload(); break;
    case 'reload-hard':   wv?.reloadIgnoringCache(); break;
    case 'back':          if (wv?.canGoBack()) wv.goBack(); break;
    case 'forward':       if (wv?.canGoForward()) wv.goForward(); break;
    case 'home':          navigateActive(HOME_PAGE); break;
    case 'bookmark':      toggleBookmark(); break;
    case 'toggle-bookmarks-bar': bookmarksBar.classList.toggle('hidden'); break;
    case 'history':       historyOverlay.hidden ? openHistory() : closeHistory(); break;
    case 'find':          openFind(); break;
    case 'zoom-in':       setZoom(0.5); break;
    case 'zoom-out':      setZoom(-0.5); break;
    case 'zoom-reset':    setZoom(0); break;
    case 'devtools':
      if (wv) wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools();
      break;
  }
}

// ── Listeners de botões/inputs ──────────────────────────────────────────
urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { navigateActive(urlBar.value); activeTab()?.webview.focus(); }
  else if (e.key === 'Escape') { urlBar.value = activeTab()?.url || ''; urlBar.blur(); }
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
btnNewTab.addEventListener('click', () => createTab(HOME_PAGE));
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
const winMax = $('win-max');
const icoMax = winMax.querySelector('.ico-max');
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

// Fallback de teclado para Escape global
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!appMenu.hidden) toggleAppMenu(false);
    else if (!historyOverlay.hidden) closeHistory();
    else if (!findBar.hidden) closeFind();
  }
});

// ── Inicialização ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  HOME_PAGE = await API.getHomePage();
  setMaxIcon(await API.window.isMaximized());
  await renderBookmarksBar();
  createTab(HOME_PAGE);
});
