# CFBrowser — Contexto para o Claude

## O que é este projeto

Browser desktop construído com **Electron 28 (Chromium 120)** + HTML/CSS/JS vanilla (sem framework de UI). Não usa React, webpack ou transpilação — o código roda diretamente no Electron.

O diferencial central é **autenticação com certificado digital A3/A1** (padrão ICP-Brasil), com diálogo customizado de seleção de certificado. É usado para acessar sistemas do governo brasileiro (e-CAC, gov.br, etc.).

---

## Estrutura de arquivos

```
navegador/
├── main.js                 # Main process: janela, sessão, stealth, IPC, certificado
├── preload.js              # Bridge segura main↔renderer (contextBridge)
├── preload-cert.js         # Bridge exclusiva do diálogo de certificado
├── webview-preload.js      # Injetado em TODA <webview>: stealth mínimo (só window.chrome)
├── store.js                # Persistência JSON: histórico e favoritos (HistoryStore, BookmarksStore)
├── proxy/
│   └── interceptor.js      # webRequest: loga requests, aplica regras de redirecionamento
├── renderer/
│   ├── index.html          # Shell do browser (tab-bar, navbar, webviews, overlays)
│   ├── browser.js          # Toda a lógica de UI: abas, favoritos, histórico, find, zoom
│   ├── style.css           # Tema escuro, layout flexbox
│   ├── cert-dialog.html    # Janela modal de seleção de certificado
│   └── cert-dialog.js      # Lógica do diálogo de certificado
├── certs/                  # Pasta para .pfx opcional (configurado em main.js)
├── extensions/             # Extensões Chromium carregadas automaticamente ao iniciar
└── package.json            # electron ^28, sem dependências de runtime
```

---

## Arquitetura de abas

Cada aba é um par `<div class="tab">` (barra de abas) + `<webview>` (área de conteúdo). Não há processo separado por aba — todas as `<webview>` ficam no DOM da janela principal. A aba ativa tem classe `active`; as inativas têm `display:none`.

- Estado gerenciado em `tabs[]` no renderer (`browser.js`)
- A sessão **`persist:main`** é compartilhada por todas as webviews (cookies, cache, login persistem entre sessões)
- Popups (`window.open`, `target=_blank`) são interceptados e viram novas abas via `setWindowOpenHandler`

---

## Stealth (anti-fingerprint)

O Electron por padrão se denuncia como bot. As correções são:

| Problema | Solução | Onde |
|---|---|---|
| `navigator.userAgent` contém "Electron" | `ses.setUserAgent(CHROME_UA)` + `onBeforeSendHeaders` | `main.js → configureSession()` |
| `navigator.webdriver = true` | Switch `--disable-blink-features=AutomationControlled` | `main.js` (antes de `app.whenReady`) |
| `window.chrome` não existe | Adição simples em JS | `webview-preload.js` |
| Idioma | `ses.setUserAgent(ua, 'pt-BR,pt,en-US,en')` + switch `--lang=pt-BR` | `main.js` |
| Client Hints (`Sec-CH-UA`) | Sobrescritos em `onBeforeSendHeaders` | `main.js → configureSession()` |

**Não sobrescrevemos funções nativas** (WebGL, permissions, plugins). O Chromium já reporta valores reais e consistentes. Sobrescrever em JS deixa `toString()` diferente de `[native code]`, o que é detectável e piora a pontuação de bot.

---

## Certificado digital

Fluxo no `main.js`:

1. `app.on('select-client-certificate')` intercepta a requisição do site
2. Se houver `.pfx` configurado em `CLIENT_CERT_PATH` e o site não listou certs do sistema → injeta direto
3. Caso contrário → abre `showCertDialog()`: janela modal (`BrowserWindow`) carregando `cert-dialog.html`
4. A lista de certs é enviada via IPC (`cert-list`); o índice escolhido volta via `cert-selected` ou `cert-cancelled`
5. O callback do Electron recebe o objeto `Certificate` escolhido

Para habilitar um `.pfx` fixo: editar `CLIENT_CERT_PATH` e `CLIENT_CERT_PASSWORD` no topo de `main.js`.

---

## Persistência

`store.js` exporta `HistoryStore` e `BookmarksStore`. Gravam em `app.getPath('userData')`:
- **`history.json`** — array de `{url, title, visitedAt, visits}`, máx 5000 entradas, entrada mais recente no índice 0
- **`bookmarks.json`** — array de `{url, title, addedAt}`

Escrita atômica: grava em `.tmp` e renomeia, evitando corrupção se o processo morrer.

---

## IPC exposto ao renderer

Via `window.browserAPI` (preload.js):

```js
browserAPI.getHomePage()                     // → Promise<string>
browserAPI.history.add(url, title)           // send (sem retorno)
browserAPI.history.list(limit?)             // → Promise<Entry[]>
browserAPI.history.search(query)            // → Promise<Entry[]>
browserAPI.history.clear()                  // → Promise<[]>
browserAPI.history.remove(url)              // → Promise<Entry[]>
browserAPI.bookmarks.list()                 // → Promise<Bookmark[]>
browserAPI.bookmarks.has(url)               // → Promise<boolean>
browserAPI.bookmarks.toggle(url, title)     // → Promise<{bookmarked, list}>
browserAPI.bookmarks.remove(url)            // → Promise<Bookmark[]>
browserAPI.window.minimize()               // send
browserAPI.window.toggleMaximize()         // send
browserAPI.window.close()                  // send
browserAPI.window.isMaximized()            // → Promise<boolean>
browserAPI.window.onMaximizeChange(cb)     // listener
browserAPI.onMenuAction(cb)                // recebe ações do menu nativo / atalhos
```

---

## Atalhos de teclado

Registrados como `accelerator` no Menu do Electron (`buildMenu()` em `main.js`). Funcionam mesmo com foco dentro da `<webview>` porque o Menu intercepta no nível da janela.

Principais: `Ctrl+T` (nova aba), `Ctrl+W` (fechar aba), `Ctrl+Shift+T` (reabrir), `Ctrl+L` (foco URL), `Ctrl+Tab` / `Ctrl+Shift+Tab` (navegar abas), `Ctrl+1-9` (ir para aba N), `Ctrl+D` (favoritar), `Ctrl+H` (histórico), `Ctrl+F` (busca na página), `F12` / `Ctrl+Shift+I/C` (DevTools), `Ctrl+R` / `Ctrl+Shift+R` (recarregar / forçado), `Ctrl+± 0` (zoom).

O menu está oculto (janela frameless), mas segue registrado e funcional.

---

## Janela (frameless)

A janela é `frame: false` — sem barra de título e menu nativos. A barra de abas (`#tab-bar`) é a região de arrasto (`-webkit-app-region: drag`). Os botões minimizar/maximizar/fechar são elementos HTML com SVG no estilo Windows, comunicando-se via IPC.

---

## Como rodar

```
npm start
```

Self-test de fingerprint (fecha sozinho após testar o ECAC):
```
set CFB_DIAG=1 && npm start
```

**Nota:** se o ambiente tiver `ELECTRON_RUN_AS_NODE=1`, o Electron inicia como Node puro e `app` fica `undefined`. Remover essa variável antes de rodar.

---

## Extensões

Qualquer extensão desempacotada em `extensions/<nome-da-pasta>/` é carregada automaticamente. A pasta existe mas está vazia por padrão.

---

## O que NÃO existe (ainda)

- Downloads com painel de progresso
- Gerenciador de senhas
- Perfis de usuário múltiplos
- Página "nova aba" customizada
- Impressão
- Sincronização
