# Certix — Contexto para o Claude

## O que é este projeto

Browser desktop construído com **Electron 28 (Chromium 120)** + HTML/CSS/JS vanilla (sem framework de UI). Não usa React, webpack ou transpilação — o código roda diretamente no Electron.

O diferencial central é **autenticação com certificado digital A3/A1** (padrão ICP-Brasil), com diálogo customizado de seleção de certificado. É usado para acessar sistemas do governo brasileiro (e-CAC, gov.br, etc.).

**Nome do produto:** Certix (definido em `package.json` → `productName`)

---

## Estrutura de arquivos

```
navegador/
├── main.js                 # Main process: janela, sessão, stealth, IPC, certificado, downloads
├── preload.js              # Bridge segura main↔renderer (contextBridge)
├── preload-cert.js         # Bridge exclusiva do diálogo de certificado
├── webview-preload.js      # Injetado em TODA <webview>: stealth mínimo (só window.chrome)
├── store.js                # Persistência JSON: histórico, favoritos, sessão, certs recentes, zoom
├── proxy/
│   └── interceptor.js      # webRequest: loga requests, aplica regras de redirecionamento
├── renderer/
│   ├── index.html          # Shell do browser (tab-bar, navbar, webviews, overlays)
│   ├── browser.js          # Toda a lógica de UI: abas, favoritos, histórico, find, zoom, downloads
│   ├── style.css           # Tema escuro, layout flexbox
│   ├── cert-dialog.html    # Janela modal de seleção de certificado
│   └── cert-dialog.js      # Lógica do diálogo de certificado (com seção Recentes)
├── certs/                  # Pasta para .pfx opcional (configurado em main.js)
├── extensions/             # Extensões Chromium carregadas automaticamente ao iniciar
└── package.json            # electron ^28, sem dependências de runtime
```

---

## Arquitetura de abas

Cada aba é um par `<div class="tab">` (barra de abas) + `<webview>` (área de conteúdo). Não há processo separado por aba — todas as `<webview>` ficam no DOM da janela principal. A aba ativa tem classe `active`; as inativas têm `display:none`.

- Estado gerenciado em `tabs[]` no renderer (`browser.js`), cada tab tem propriedade `isNewTab` (boolean)
- A sessão **`persist:main`** é compartilhada por todas as webviews (cookies, cache, login persistem entre sessões)
- Popups (`window.open`, `target=_blank`) são interceptados e viram novas abas via `setWindowOpenHandler`

### Nova aba (new tab overlay)

Quando `tab.isNewTab === true`, exibe o overlay `#newtab-overlay` (HTML dentro de `#webviews`, não uma página separada), com:
- Logo "Certix"
- Campo de busca/URL
- Seção de favoritos
- Seção de visitados recentemente

Isso contorna a limitação de webviews não terem acesso ao `browserAPI`.

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
4. A lista de certs é enviada via IPC (`cert-list`) com `{ url, list, recent }` — `recent` vem do `CertRecentStore`
5. O diálogo exibe seção **"Recentes"** no topo e **"Todos"** abaixo
6. O índice escolhido volta via `cert-selected` ou `cert-cancelled`
7. `certRecent.add()` é chamado ao confirmar a escolha

Para habilitar um `.pfx` fixo: editar `CLIENT_CERT_PATH` e `CLIENT_CERT_PASSWORD` no topo de `main.js`.

**Estratégia de recentes:** não há memória por-site — o usuário pode usar certificados diferentes em horários diferentes. O histórico de recentes (até 10) facilita a seleção sem forçar uma escolha automática.

---

## Downloads

O handler `will-download` em `configureSession()` (`main.js`) processa cada download automaticamente:

1. Resolve o caminho em `app.getPath('downloads')`
2. Trata colisões de nome: se o arquivo já existe, adiciona ` (1)`, ` (2)`, etc.
3. Chama `item.setSavePath()` sincronamente (obrigatório pelo Electron)
4. Emite eventos IPC para o renderer: `download:start`, `download:updated`, `download:done`

### UI de downloads

- **Barra de downloads** (`#download-bar`): aparece automaticamente ao iniciar um download, mostra barra de progresso e botões Open/Dismiss
- **Overlay de downloads** (`#downloads-overlay`): painel completo acessível via menu ⋮ → Downloads ou `Ctrl+J`; lista todos os downloads da sessão com progresso em tempo real, botões "Abrir" (shell) e "Remover", botão "Limpar concluídos"

---

## Persistência

`store.js` exporta cinco classes. Todas gravam em `app.getPath('userData')` com escrita atômica (grava em `.tmp` e renomeia):

| Classe | Arquivo | Conteúdo |
|---|---|---|
| `HistoryStore` | `history.json` | `{url, title, visitedAt, visits}[]`, máx 5000, mais recente no índice 0 |
| `BookmarksStore` | `bookmarks.json` | `{url, title, addedAt}[]` |
| `SessionStore` | `session.json` | `{tabs: [{url, title}]}` — salvo com debounce de 800ms |
| `CertRecentStore` | `cert-recent.json` | `{subjectName, fingerprint, lastUsed}[]`, máx 10 |
| `ZoomStore` | `zoom.json` | `{ [hostname]: zoomLevel }` — nível 0 significa "padrão" |

### Restauração de sessão

Ao iniciar, o browser sempre abre a `HOME_PAGE` como aba ativa. Em seguida, as abas da sessão anterior são restauradas como abas inativas em segundo plano. O usuário sempre vê a home page ao abrir o Certix.

---

## Autocomplete de URL

Campo `#url-bar` tem autocomplete com debounce de 150ms:
- Consulta histórico e favoritos via `browserAPI`
- Posiciona o dropdown `#url-suggestions` via `getBoundingClientRect()` dentro de `#app` (`position: relative`)
- Navega com ↑↓ e confirma com Enter

---

## IPC exposto ao renderer

Via `window.browserAPI` (preload.js):

```js
browserAPI.getHomePage()                     // → Promise<string>
browserAPI.history.add(url, title)           // send (sem retorno)
browserAPI.history.list(limit?)              // → Promise<Entry[]>
browserAPI.history.search(query)             // → Promise<Entry[]>
browserAPI.history.clear()                   // → Promise<[]>
browserAPI.history.remove(url)               // → Promise<Entry[]>
browserAPI.bookmarks.list()                  // → Promise<Bookmark[]>
browserAPI.bookmarks.has(url)                // → Promise<boolean>
browserAPI.bookmarks.toggle(url, title)      // → Promise<{bookmarked, list}>
browserAPI.bookmarks.remove(url)             // → Promise<Bookmark[]>
browserAPI.session.save(data)                // send — salva {tabs:[{url,title}]}
browserAPI.session.load()                    // → Promise<{tabs}|null>
browserAPI.zoom.set(hostname, level)         // → Promise<void>
browserAPI.zoom.get(hostname)                // → Promise<number>
browserAPI.downloads.onStart(cb)             // listener: {id, filename, savePath, total}
browserAPI.downloads.onProgress(cb)          // listener: {id, received, total}
browserAPI.downloads.onDone(cb)              // listener: {id, state, savePath}
browserAPI.downloads.openFile(savePath)      // abre o arquivo com shell.openPath
browserAPI.window.minimize()                 // send
browserAPI.window.toggleMaximize()           // send
browserAPI.window.close()                    // send
browserAPI.window.isMaximized()              // → Promise<boolean>
browserAPI.window.onMaximizeChange(cb)       // listener
browserAPI.onMenuAction(cb)                  // recebe ações do menu nativo / atalhos
```

---

## Atalhos de teclado

Registrados como `accelerator` no Menu do Electron (`buildMenu()` em `main.js`). Funcionam mesmo com foco dentro da `<webview>` porque o Menu intercepta no nível da janela.

| Atalho | Ação |
|---|---|
| `Ctrl+T` | Nova aba |
| `Ctrl+W` | Fechar aba |
| `Ctrl+Shift+T` | Reabrir aba fechada |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Navegar entre abas |
| `Ctrl+1-9` | Ir para aba N |
| `Ctrl+L` | Foco na barra de URL |
| `Ctrl+R` / `Ctrl+Shift+R` | Recarregar / forçado (ignora cache) |
| `Ctrl+D` | Adicionar/remover favorito |
| `Ctrl+H` | Abrir histórico |
| `Ctrl+J` | Abrir painel de downloads |
| `Ctrl+F` | Buscar na página |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom + / - / normal |
| `Ctrl+P` | Imprimir |
| `F12` / `Ctrl+Shift+I/C` | DevTools |
| `Alt+←` / `Alt+→` | Voltar / Avançar |
| `Alt+Home` | Página inicial |

O menu está oculto (janela frameless), mas segue registrado e funcional.

---

## Janela (frameless)

A janela é `frame: false` — sem barra de título e menu nativos. A barra de abas (`#tab-bar`) é a região de arrasto (`-webkit-app-region: drag`). Os botões minimizar/maximizar/fechar são elementos HTML com SVG no estilo Windows, comunicando-se via IPC.

---

## Como rodar

```cmd
npm start
```

Self-test de fingerprint (fecha sozinho após testar o ECAC):
```cmd
set CFB_DIAG=1 && npm start
```

Teste de download (baixa 100MB.bin da Hetzner e exibe progresso no terminal):
```cmd
set CFB_DL_TEST=1 && npm start
```

**Nota:** se o ambiente tiver `ELECTRON_RUN_AS_NODE=1`, o Electron inicia como Node puro e `app` fica `undefined`. Remover essa variável antes de rodar.

---

## Extensões

Qualquer extensão desempacotada em `extensions/<nome-da-pasta>/` é carregada automaticamente. A pasta existe mas está vazia por padrão.

---

## O que NÃO existe (ainda)

- Gerenciador de senhas
- Perfis de usuário múltiplos
- Sincronização com plataforma online (próxima fase)
- Impressão nativa completa (atalho `Ctrl+P` registrado, chama `wv.print()`, mas depende do suporte do site)
