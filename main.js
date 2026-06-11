/**
 * Main process do Electron — ponto de entrada da aplicação.
 *
 * Responsabilidades:
 *   - Criar a janela principal do browser (multi-abas)
 *   - Configurar interceptação de requests via proxy/interceptor.js
 *   - Fazer o browser se passar por um Chrome real (stealth / anti-fingerprint)
 *   - Injetar certificado de cliente (.pfx) e mostrar diálogo de seleção
 *   - Aceitar certificados self-signed / internos
 *   - Persistir histórico e favoritos
 *   - Carregar extensões da pasta /extensions
 *   - Atalhos de teclado via Menu (Ctrl+T, Ctrl+L, F12, ...)
 */

const { app, BrowserWindow, session, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { setupInterceptor } = require('./proxy/interceptor');
const { HistoryStore, BookmarksStore, SessionStore, CertRecentStore, ZoomStore } = require('./store');

// ---------------------------------------------------------------------------
// BRANDING — altere as variáveis abaixo para customizar o browser
// ---------------------------------------------------------------------------
const APP_NAME = 'Certix';
const HOME_PAGE = 'https://www.google.com';

// Partição persistente usada por todas as abas (cookies/login sobrevivem entre sessões)
const WEBVIEW_PARTITION = 'persist:main';

// Regras de redirecionamento: { from: string, to: string }[]
const REDIRECT_RULES = [];

// Caminho e senha do certificado cliente .pfx (deixe null para desativar)
const CLIENT_CERT_PATH = null;   // ex: path.join(__dirname, 'certs', 'meu-cert.pfx')
const CLIENT_CERT_PASSWORD = ''; // senha do .pfx

// ---------------------------------------------------------------------------
// STEALTH — flags de linha de comando (DEVEM ser definidas antes do app ready)
// ---------------------------------------------------------------------------
// Remove navigator.webdriver e o infobar de "controlado por automação" no nível
// do Blink — cobre inclusive iframes de terceiros (ex: o widget do hCaptcha).
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// Idioma padrão consistente com um Chrome brasileiro.
app.commandLine.appendSwitch('lang', 'pt-BR');

app.setName(APP_NAME);

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
let mainWindow = null;
let CHROME_UA = '';
let SEC_CH_UA = '';
let SEC_CH_UA_FULL = '';
let history = null;
let bookmarks = null;
let sessionStore = null;
let certRecent = null;
let zoomStore = null;
const WEBVIEW_PRELOAD = path.join(__dirname, 'webview-preload.js');

// ---------------------------------------------------------------------------
// Construção do User-Agent "Chrome real"
// ---------------------------------------------------------------------------
// Estratégia: pegar o UA padrão do Electron e remover apenas os tokens que o
// denunciam (Electron/x e NomeDoApp/x). O que sobra é idêntico ao Chrome da
// mesma versão de Chromium — garantindo consistência com os Client Hints.
function buildChromeUA() {
  let ua = app.userAgentFallback || session.defaultSession.getUserAgent();
  ua = ua
    .replace(/ Electron\/[^\s]+/i, '')
    .replace(new RegExp(` ${APP_NAME}\\/[^\\s]+`, 'i'), '')
    .replace(/ cfbrowser\/[^\s]+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return ua;
}

// Client Hints (Sec-CH-UA) coerentes com o UA — sem marca "Electron".
function buildClientHints(ua) {
  const m = ua.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  const major = m ? m[1] : '120';
  const full = m ? `${m[1]}.${m[2]}.${m[3]}.${m[4]}` : '120.0.0.0';
  SEC_CH_UA = `"Not_A Brand";v="8", "Chromium";v="${major}", "Google Chrome";v="${major}"`;
  SEC_CH_UA_FULL = `"Not_A Brand";v="8.0.0.0", "Chromium";v="${full}", "Google Chrome";v="${full}"`;
}

// ---------------------------------------------------------------------------
// Carregamento de extensões da pasta /extensions
// ---------------------------------------------------------------------------
async function loadExtensions(ses) {
  const extensionsDir = path.join(__dirname, 'extensions');
  if (!fs.existsSync(extensionsDir)) return;

  const dirs = fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirs.length === 0) return;

  for (const dir of dirs) {
    const extPath = path.join(extensionsDir, dir);
    try {
      const ext = await ses.loadExtension(extPath, { allowFileAccess: true });
      console.log(`[Extensions] Carregada: ${ext.name}`);
    } catch (err) {
      console.error(`[Extensions] Falha ao carregar ${dir}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Injeção de certificado cliente (.pfx)
// ---------------------------------------------------------------------------
function loadClientCert(pfxPath, password) {
  if (!pfxPath || !fs.existsSync(pfxPath)) return null;
  try {
    return { data: fs.readFileSync(pfxPath), password };
  } catch (err) {
    console.error('[Cert] Erro ao ler certificado:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Criação da janela principal
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    title: APP_NAME,
    frame: false,            // sem barra de título/menu nativos — usamos UI própria
    backgroundColor: '#0d1b2a',
    // icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Avisa o renderer quando o estado de maximização muda (para trocar o ícone).
  const sendMaxState = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);

  // Força configurações seguras + stealth em TODA <webview> criada pelo renderer.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    webPreferences.preload = WEBVIEW_PRELOAD;
    webPreferences.contextIsolation = false; // necessário p/ o preload patchar o main world
    webPreferences.nodeIntegration = false;  // página nunca recebe Node
    webPreferences.sandbox = false;
    params.partition = WEBVIEW_PARTITION;     // todas as abas compartilham a sessão persistente
  });

  // Popups (window.open / target=_blank) viram novas abas em vez de janelas.
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (url && url !== 'about:blank') {
        mainWindow.webContents.send('menu', 'open-url-newtab', url);
      }
      return { action: 'deny' };
    });

    // Self-test opcional: `set CFB_DIAG=1 && npm start` valida o stealth e o ECAC.
    if (process.env.CFB_DIAG) runDiagnostics(guest);
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// Diálogo customizado de seleção de certificado (inalterado)
// ---------------------------------------------------------------------------
function showCertDialog(url, list, callback) {
  const dialog = new BrowserWindow({
    width: 560, height: 480,
    title: 'Selecionar Certificado — CFBrowser',
    parent: mainWindow, modal: true,
    resizable: false, minimizable: false, maximizable: false, frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-cert.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dialog.loadFile(path.join(__dirname, 'renderer', 'cert-dialog.html'));

  dialog.webContents.once('did-finish-load', () => {
    const serializable = list.map((c) => ({
      subjectName: c.subjectName,
      issuerName: c.issuerName,
      serialNumber: c.serialNumber,
      validStart: c.validStart,
      validExpiry: c.validExpiry,
      fingerprint: c.fingerprint,
    }));
    dialog.webContents.send('cert-list', { url, list: serializable, recent: certRecent.list() });
  });

  let settled = false;
  function resolve(cert) {
    if (settled) return;
    settled = true;
    ipcMain.removeAllListeners('cert-selected');
    ipcMain.removeAllListeners('cert-cancelled');
    if (!dialog.isDestroyed()) dialog.close();
    if (cert) certRecent.add({ subjectName: cert.subjectName, fingerprint: cert.fingerprint });
    console.log(cert !== undefined
      ? `[Cert] Selecionado: ${cert?.subjectName}` : '[Cert] Cancelado.');
    callback(cert);
  }

  ipcMain.once('cert-selected', (_e, index) => resolve(list[index]));
  ipcMain.once('cert-cancelled', () => resolve(undefined));
  dialog.on('closed', () => resolve(undefined));
}

// ---------------------------------------------------------------------------
// Configuração da session persistente das abas
// ---------------------------------------------------------------------------
function configureSession() {
  const ses = session.fromPartition(WEBVIEW_PARTITION);

  // UA limpo (Chrome real) + Accept-Language natural na sessão das abas.
  // O 2º argumento ajusta nativamente tanto o header Accept-Language quanto
  // navigator.languages — sem adulterar getters em JS.
  ses.setUserAgent(CHROME_UA, 'pt-BR,pt,en-US,en');

  // Interceptar requests e aplicar regras de redirecionamento.
  setupInterceptor(ses, REDIRECT_RULES);

  // Normalizar Client Hints + reforçar UA em cada request (remove marca Electron).
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    for (const key of Object.keys(h)) {
      const k = key.toLowerCase();
      if (k === 'user-agent') h[key] = CHROME_UA;
      else if (k === 'sec-ch-ua') h[key] = SEC_CH_UA;
      else if (k === 'sec-ch-ua-full-version-list') h[key] = SEC_CH_UA_FULL;
      else if (k === 'sec-ch-ua-platform') h[key] = '"Windows"';
    }
    callback({ requestHeaders: h });
  });

  // Aceitar certificados self-signed / de autoridades internas.
  ses.setCertificateVerifyProc((_request, callback) => callback(0));

  // Permissões — conceder automaticamente apenas o conjunto seguro; demais precisam
  // ser aprovadas explicitamente (câmera e microfone ficam para o Chromium nativo).
  const AUTO_GRANT = new Set(['notifications', 'fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(AUTO_GRANT.has(permission)));

  // Downloads — salva em ~/Downloads e notifica o renderer com progresso.
  ses.on('will-download', (_event, item) => {
    const id = Date.now();
    const filename = item.getFilename();
    const savePath = path.join(app.getPath('downloads'), filename);
    item.setSavePath(savePath);
    const notify = (ch, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
    };
    notify('download:start', { id, filename, savePath, total: item.getTotalBytes() });
    item.on('updated', (_e, state) =>
      notify('download:progress', { id, state, received: item.getReceivedBytes(), total: item.getTotalBytes() }));
    item.on('done', (_e, state) =>
      notify('download:done', { id, state, savePath, filename }));
  });

  // Seleção de certificado cliente — evento de app, vale para todas as sessões.
  app.on('select-client-certificate', (event, _webContents, url, list, callback) => {
    event.preventDefault();
    const clientCert = loadClientCert(CLIENT_CERT_PATH, CLIENT_CERT_PASSWORD);
    if (clientCert && list.length === 0) {
      callback({ pfx: clientCert.data, passphrase: clientCert.password });
      return;
    }
    showCertDialog(url, list, callback);
  });

  // A defaultSession (janela host) também aceita certs internos, por garantia.
  session.defaultSession.setCertificateVerifyProc((_r, cb) => cb(0));

  console.log('[Session] Stealth, certificados e interceptor configurados.');
  return ses;
}

// ---------------------------------------------------------------------------
// Handlers IPC
// ---------------------------------------------------------------------------
function setupIpcHandlers() {
  ipcMain.handle('get-home-page', () => HOME_PAGE);

  // Controles de janela (substituem os botões nativos da barra de título)
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => !!mainWindow?.isMaximized());

  // Histórico
  ipcMain.on('history:add', (_e, { url, title }) => history.add(url, title));
  ipcMain.handle('history:list', (_e, limit) => history.list(limit));
  ipcMain.handle('history:search', (_e, q) => history.search(q));
  ipcMain.handle('history:clear', () => { history.clear(); return []; });
  ipcMain.handle('history:remove', (_e, url) => { history.removeUrl(url); return history.list(); });

  // Sessão
  ipcMain.handle('session:save', (_e, data) => sessionStore.save(data));
  ipcMain.handle('session:load', () => sessionStore.load());

  // Zoom por site
  ipcMain.handle('zoom:set', (_e, { hostname, level }) => zoomStore.set(hostname, level));
  ipcMain.handle('zoom:get', (_e, hostname) => zoomStore.get(hostname));

  // Shell — abrir arquivo/pasta no explorador
  ipcMain.handle('shell:open-path', (_e, filePath) => shell.openPath(filePath));

  // Favoritos
  ipcMain.handle('bookmarks:list', () => bookmarks.list());
  ipcMain.handle('bookmarks:has', (_e, url) => bookmarks.has(url));
  ipcMain.handle('bookmarks:toggle', (_e, { url, title }) => bookmarks.toggle(url, title));
  ipcMain.handle('bookmarks:remove', (_e, url) => bookmarks.remove(url));
}

// ---------------------------------------------------------------------------
// Menu da aplicação — fonte dos atalhos de teclado.
// Accelerators funcionam mesmo quando o foco está dentro da <webview>.
// ---------------------------------------------------------------------------
function send(action, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu', action, ...args);
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const tabNumberItems = [];
  for (let i = 1; i <= 8; i++) {
    tabNumberItems.push({
      label: `Ir para aba ${i}`,
      accelerator: `CmdOrCtrl+${i}`,
      click: () => send('select-tab', i - 1),
      visible: false,
    });
  }
  tabNumberItems.push({
    label: 'Ir para última aba', accelerator: 'CmdOrCtrl+9',
    click: () => send('select-tab', 'last'), visible: false,
  });

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Nova aba', accelerator: 'CmdOrCtrl+T', click: () => send('new-tab') },
        { label: 'Reabrir aba fechada', accelerator: 'CmdOrCtrl+Shift+T', click: () => send('reopen-tab') },
        { label: 'Fechar aba', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab') },
        { type: 'separator' },
        { role: isMac ? 'close' : 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
        { type: 'separator' },
        { label: 'Buscar na página', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
        { label: 'Ir para a barra de endereço', accelerator: 'CmdOrCtrl+L', click: () => send('focus-url') },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => send('reload') },
        { label: 'Recarregar (forçado)', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('reload-hard') },
        { label: 'Recarregar (F5)', accelerator: 'F5', click: () => send('reload'), visible: false },
        { type: 'separator' },
        { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+Plus', click: () => send('zoom-in') },
        { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in'), visible: false },
        { label: 'Diminuir zoom', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { label: 'Zoom normal', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') },
        { type: 'separator' },
        { label: 'Imprimir', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { label: 'Ferramentas do desenvolvedor', accelerator: 'F12', click: () => send('devtools') },
        { label: 'DevTools (Ctrl+Shift+I)', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('devtools'), visible: false },
        { label: 'Inspecionar (Ctrl+Shift+C)', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('devtools'), visible: false },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
    {
      label: 'Histórico',
      submenu: [
        { label: 'Voltar', accelerator: 'Alt+Left', click: () => send('back') },
        { label: 'Avançar', accelerator: 'Alt+Right', click: () => send('forward') },
        { type: 'separator' },
        { label: 'Página inicial', accelerator: 'Alt+Home', click: () => send('home') },
        { label: 'Mostrar histórico', accelerator: 'CmdOrCtrl+H', click: () => send('history') },
      ],
    },
    {
      label: 'Favoritos',
      submenu: [
        { label: 'Adicionar/remover favorito', accelerator: 'CmdOrCtrl+D', click: () => send('bookmark') },
        { label: 'Mostrar barra de favoritos', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('toggle-bookmarks-bar') },
      ],
    },
    {
      label: 'Abas',
      submenu: [
        { label: 'Próxima aba', accelerator: 'Control+Tab', click: () => send('next-tab') },
        { label: 'Próxima aba', accelerator: 'CmdOrCtrl+PageDown', click: () => send('next-tab'), visible: false },
        { label: 'Aba anterior', accelerator: 'Control+Shift+Tab', click: () => send('prev-tab') },
        { label: 'Aba anterior', accelerator: 'CmdOrCtrl+PageUp', click: () => send('prev-tab'), visible: false },
        ...tabNumberItems,
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Diagnóstico opt-in (CFB_DIAG=1) — verifica stealth e acesso ao ECAC, e sai.
// ---------------------------------------------------------------------------
function runDiagnostics(guest) {
  const ECAC = 'https://cav.receita.fazenda.gov.br/autenticacao/login';
  const CHECK = `(${function () {
    // Verifica se uma função ainda é nativa ("[native code]") ou foi adulterada.
    const isNative = (fn) => { try { return /\[native code\]/.test(Function.prototype.toString.call(fn)); } catch (_) { return false; } };
    let glVendor = null, glRenderer = null, glGetParamNative = null;
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (gl) {
        glGetParamNative = isNative(gl.getParameter);
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          glVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
          glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch (_) {}
    return JSON.stringify({
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver,
      webdriverNative: isNative(Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')?.get || function(){}),
      hasChrome: typeof window.chrome === 'object',
      hasChromeRuntime: !!(window.chrome && window.chrome.runtime),
      plugins: navigator.plugins.length,
      languages: navigator.languages,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      glVendor, glRenderer, glGetParamNative,
      permsQueryNative: isNative(navigator.permissions && navigator.permissions.query),
    });
  }})()`;

  const log = (...a) => console.log('[DIAG]', ...a);
  let phase = 0;

  guest.on('did-stop-loading', async () => {
    try {
      if (phase === 0) {
        phase = 1;
        const r = JSON.parse(await guest.executeJavaScript(CHECK));
        log('userAgent           =', r.userAgent);
        log('contém "Electron"?  =', /electron/i.test(r.userAgent) ? 'SIM ❌' : 'NÃO ✅');
        log('webdriver           =', r.webdriver, '| getter nativo:', r.webdriverNative);
        log('window.chrome       =', r.hasChrome, '| runtime:', r.hasChromeRuntime);
        log('plugins             =', r.plugins);
        log('languages           =', JSON.stringify(r.languages));
        log('platform            =', r.platform, '| cores:', r.hardwareConcurrency, '| mem:', r.deviceMemory);
        log('WebGL vendor        =', r.glVendor);
        log('WebGL renderer      =', r.glRenderer);
        log('WebGL getParameter nativo? =', r.glGetParamNative, r.glGetParamNative ? '✅' : '❌ (adulterado)');
        log('permissions.query nativo?  =', r.permsQueryNative, r.permsQueryNative ? '✅' : '❌ (adulterado)');
        log('navegando para o ECAC...');
        guest.loadURL(ECAC);
      } else if (phase === 1) {
        phase = 2;
        log('ECAC URL    :', guest.getURL());
        log('ECAC título :', guest.getTitle());
        log('Concluído. Encerrando.');
        setTimeout(() => app.quit(), 500);
      }
    } catch (err) {
      log('ERRO:', err.message);
      app.quit();
    }
  });

  guest.on('did-fail-load', (_e, code, desc, url) => {
    if (code !== -3) log(`Falha ao carregar (${code} ${desc}) ${url}`);
  });
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  CHROME_UA = buildChromeUA();
  buildClientHints(CHROME_UA);
  app.userAgentFallback = CHROME_UA; // aplica o UA limpo a todas as sessões novas
  console.log(`[Stealth] User-Agent: ${CHROME_UA}`);

  history = new HistoryStore(app.getPath('userData'));
  bookmarks = new BookmarksStore(app.getPath('userData'));
  sessionStore = new SessionStore(app.getPath('userData'));
  certRecent = new CertRecentStore(app.getPath('userData'));
  zoomStore = new ZoomStore(app.getPath('userData'));

  const ses = configureSession();
  setupIpcHandlers();
  buildMenu();
  createWindow();
  await loadExtensions(ses);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
