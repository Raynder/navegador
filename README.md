# CFBrowser

Browser desktop para Windows construído com Electron, focado em acesso a sistemas do governo brasileiro com certificado digital A1/A3.

## Por que existe

Sistemas como o **e-CAC (Receita Federal)** e portais **gov.br** exigem certificado digital para autenticação. Browsers comuns como Chrome e Edge não permitem customizar o fluxo de seleção de certificado. O CFBrowser resolve isso com um diálogo customizado que lista os certificados disponíveis no sistema, mostra validade e detalhes, e permite escolher qual usar.

## Funcionalidades

**Navegação**
- Múltiplas abas com favicon, título e indicador de carregamento
- Barra de URL com indicador de segurança (HTTPS/HTTP)
- Botões voltar, avançar, recarregar, home
- Pesquisa no Google como fallback para entradas sem URL
- Busca na página (`Ctrl+F`)
- Controle de zoom (`Ctrl+±` e `Ctrl+0`)
- Ferramentas do desenvolvedor (`F12`)

**Abas**
- Nova aba (`Ctrl+T`), fechar (`Ctrl+W`), reabrir fechada (`Ctrl+Shift+T`)
- Navegar entre abas (`Ctrl+Tab`, `Ctrl+1-9`)
- Botão do meio do mouse fecha aba
- Links com `target=_blank` abrem em nova aba (em vez de nova janela)

**Favoritos**
- Adicionar/remover pela estrela na barra de URL ou `Ctrl+D`
- Barra de favoritos persistente abaixo da navbar
- Clique do meio abre favorito em nova aba
- Clique direito remove da barra

**Histórico**
- Gravado automaticamente a cada página carregada
- Overlay com busca em tempo real (`Ctrl+H`)
- Remoção individual ou limpeza total

**Certificado digital**
- Detecta automaticamente certificados A1/A3 instalados no Windows
- Diálogo customizado com lista de certificados, validade colorida e detalhes completos
- Navegar na lista com teclado (↑↓, Enter, Escape)
- Suporte a `.pfx` fixo via configuração em `main.js`

**Interface**
- Janela sem barra de título nativa (frameless)
- Controles minimizar/maximizar/fechar integrados ao browser
- Arrastar a janela pela barra de abas
- Duplo-clique na área vazia da barra maximiza/restaura
- Tema escuro

**Stealth (anti-bot)**
- User-Agent idêntico ao Chrome 120 (sem token "Electron")
- `navigator.webdriver = false` via flag nativa do Chromium (não adultera JS)
- Sessão persistente: cookies e logins sobrevivem ao fechar o browser
- Headers `Sec-CH-UA` coerentes com o User-Agent

## Requisitos

- Windows 10+
- Node.js 18+
- Certificados digitais instalados no repositório do Windows (para uso com sistemas gov)

## Instalação

```bash
npm install
npm start
```

## Estrutura

```
├── main.js              # Processo principal: janela, sessão, certificados, atalhos
├── preload.js           # API segura exposta ao renderer
├── preload-cert.js      # API do diálogo de certificado
├── webview-preload.js   # Injetado em cada webview (stealth mínimo)
├── store.js             # Histórico e favoritos (JSON em disco)
├── proxy/
│   └── interceptor.js   # Logging de requests e regras de redirecionamento
├── renderer/
│   ├── index.html       # Interface principal
│   ├── browser.js       # Lógica de UI (abas, favoritos, histórico)
│   ├── style.css        # Tema
│   ├── cert-dialog.html # Modal de seleção de certificado
│   └── cert-dialog.js   # Lógica do modal
├── certs/               # .pfx opcional (ver configuração abaixo)
└── extensions/          # Extensões Chromium desempacotadas (carregadas automaticamente)
```

## Configuração

No topo de `main.js`:

```js
const HOME_PAGE = 'https://www.google.com'; // página inicial

// Certificado .pfx fixo (opcional — para injetar sem diálogo)
const CLIENT_CERT_PATH = null;   // ex: path.join(__dirname, 'certs', 'meu.pfx')
const CLIENT_CERT_PASSWORD = ''; // senha do .pfx

// Redirecionamentos de URL
const REDIRECT_RULES = [
  // { from: 'https://antigo.com', to: 'https://novo.com' }
];
```

## Extensões

Coloque extensões Chromium desempacotadas em `extensions/<nome>/`. São carregadas automaticamente ao iniciar.

## Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+T` | Nova aba |
| `Ctrl+W` | Fechar aba |
| `Ctrl+Shift+T` | Reabrir aba fechada |
| `Ctrl+Tab` | Próxima aba |
| `Ctrl+Shift+Tab` | Aba anterior |
| `Ctrl+1-9` | Ir para aba N |
| `Ctrl+L` | Foco na barra de URL |
| `Ctrl+R` | Recarregar |
| `Ctrl+Shift+R` | Recarregar (ignorar cache) |
| `Ctrl+D` | Adicionar/remover favorito |
| `Ctrl+H` | Abrir histórico |
| `Ctrl+F` | Buscar na página |
| `Ctrl+=` / `Ctrl+-` | Zoom + / - |
| `Ctrl+0` | Zoom normal |
| `F12` | DevTools |
| `Alt+←` / `Alt+→` | Voltar / Avançar |
| `Alt+Home` | Página inicial |

## Diagnóstico de fingerprint

Verifica se o browser se passa por Chrome real e testa acesso ao e-CAC:

```cmd
set CFB_DIAG=1 && npm start
```

O app abre, executa os testes, imprime o resultado no terminal e fecha sozinho.

## Teste de download

Baixa o arquivo `100MB.bin` do servidor de velocidade da Hetzner e exibe progresso no terminal:

```cmd
set CFB_DL_TEST=1 && npm start
```

Exibe: evento `will-download`, velocidade a cada 10%, tamanho em disco ao concluir. Encerra sozinho.

## Tecnologia

- **Electron 28** (Chromium 120)
- HTML, CSS e JavaScript vanilla — sem framework, sem build step
- Sem dependências de runtime além do Electron
