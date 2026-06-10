# Análise do CFBrowser — apontamentos e recomendações

> Avaliação técnica e de produto do browser, separada por gravidade.
> Comece pelos itens de **segurança** (críticos) antes de qualquer feature nova.

---

## 1. Segurança — crítico para um browser de e-CAC/gov.br

Este é o ponto mais sério. É justamente onde um browser focado em **certificado digital e Receita Federal** não pode falhar.

### a) Aceita qualquer certificado TLS, inclusive inválido — `main.js:251` e `main.js:268`

```js
ses.setCertificateVerifyProc((_request, callback) => callback(0)); // 0 = aceita tudo
```

`callback(0)` diz ao Chromium "confie nesse certificado, não importa o quê". Desliga a validação de cadeia, expiração e hostname — **em todas as abas, para todos os sites**. Num browser cujo propósito é autenticar em `cav.receita.fazenda.gov.br`, isso abre a porta para man-in-the-middle exatamente nas sessões mais sensíveis (login gov, e-CAC, dados fiscais).

**Correção:** deixar o Chromium validar normalmente e só fazer exceção explícita para hosts internos conhecidos:

```js
ses.setCertificateVerifyProc((req, cb) => {
  if (TRUSTED_INTERNAL_HOSTS.includes(req.hostname)) return cb(0);
  cb(-3); // -3 = usar verificação padrão do Chromium
});
```

### b) Concede todas as permissões automaticamente — `main.js:254`

```js
ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
```

Câmera, microfone, geolocalização, notificações, clipboard — tudo liberado sem o usuário saber. Qualquer site aberto pode ligar a webcam silenciosamente. No mínimo, liberar só o conjunto seguro (`notifications`, `fullscreen`) e negar/perguntar o resto.

> Esses dois pontos juntos fazem o produto vender "segurança para gov" enquanto entrega **menos** segurança que o Chrome padrão. Corrigir antes de qualquer feature nova.

---

## 2. Layout — onde está o "amador" e como subir o nível

A estrutura não está mal (flexbox limpo, dark theme coerente), mas três coisas entregam que é um projeto pequeno:

### Sistema de ícones misturado (maior tell visual)

Três linguagens visuais ao mesmo tempo:
- Emoji para segurança/favorito: 🔒 ⚠ 📄 ⭐ (`browser.js:59-61`)
- Entidades HTML para navegação: `←` `→` `⟳` `⌂` `⋮` (`index.html:38-50`)
- SVG só para os controles de janela

Emoji renderiza diferente em cada máquina, fica colorido no meio de uma UI monocromática e não alinha bem. **Adotar um único set de ícones SVG** (Lucide ou Feather, MIT, ~1px stroke) para tudo. Sozinho, isso faz o browser parecer "de verdade".

### A paleta é a paleta de tutorial

`#1a1a2e` / `#16213e` / `#0f3460` / `#e94560` é o esquema mais reproduzido em tutoriais de dark UI. Além disso, o acento rosa-vermelho `#e94560` está em lugares demais: hover de scrollbar, botões de find, hover do histórico, delete. Vermelho deveria significar "ação destrutiva/perigo", não cor de hover geral.

- Reduzir o vermelho ao botão de fechar janela e ações de exclusão.
- Escolher **um** azul/teal de marca para hover e foco.
- O foco da barra de URL ficar vermelho (`style.css:118`) passa sensação de erro — usar a cor de marca.

### Faltam tokens

Cores e raios estão hardcoded dezenas de vezes. Mover para CSS custom properties (`:root { --bg-1; --accent; --radius; }`). Facilita inclusive o tema claro/customizável que o nome promete.

### Densidade e detalhes

- Sem **página de nova aba** — abre direto no Google.
- Barra de URL sem **autocomplete/sugestões** (histórico + favoritos enquanto digita). É a UX que mais falta percebida.
- Abas sem **drag-to-reorder** nem tooltip de loading distinto do favicon.

---

## 3. O nome — "CFBrowser" não está ajudando

- **Não comunica nada.** "CF" é ambíguo (Cloudflare? Certificado Federal?). O diferencial real — certificado digital ICP-Brasil / acesso gov — some.
- **Genérico para busca e marca.** Colide com muita coisa; difícil registrar/achar.
- `package.json` tem `name: "cfbrowser"` mas a descrição diz "customizável" — a proposta de valor (gov/certificado) não aparece no nome.

Como o produto resolve um problema específico e nacional (autenticar em e-CAC/gov.br com A1/A3), o nome deveria evocar **confiança + Brasil + certificado**.

| Direção | Exemplos |
|---|---|
| Certificado/assinatura | *Selo*, *Rúbrica*, *Chancela* |
| Acesso gov confiável | *Portal*, *Acesso*, *Despacho* |
| Curto e brandável | *Rúbrica*, *Chancela*, *Verde* (alusão ao cadeado) |

**Recomendação:** algo como **"Rúbrica"** ou **"Chancela"** — em PT-BR já significam assinatura/autenticação oficial, memoráveis e dizem o que o browser faz. No mínimo, expandir "CF" num nome real e registrar o `productName` no `package.json`/build.

---

## 4. Funcionalidades que faltam (por prioridade)

### Tier 1 — esperado em qualquer browser, sentido na primeira hora

1. **Gerenciador de downloads** com barra de progresso. Sites gov geram muito PDF/XML (DARF, comprovantes). Não há `session.on('will-download')` em lugar nenhum — downloads provavelmente quebram ou são silenciosos. Quase tão importante quanto o certificado.
2. **Autocomplete na barra de endereço** (histórico + favoritos). Os dados já existem no `store.js`; falta o dropdown.
3. **Página de nova aba** com atalhos.
4. **Restaurar sessão** ao reabrir. Hoje `closedTabs` só guarda a URL (`browser.js:39`) e some ao fechar o app.

### Tier 2 — diferencial e confiança

5. **Tela de configurações** real (UI). Hoje home page, certificado e redirects são editados na mão dentro de `main.js` (`main.js:25-35`) — inviável para o usuário final (contador, advogado).
6. **Seleção de certificado persistente** — lembrar qual cert o usuário escolheu por site.
7. **Modo anônimo / janela privada** (partição não-persistente).
8. **Impressão / salvar como PDF** — crítico para comprovantes fiscais.
9. **Zoom por site** persistente.

### Tier 3 — maturidade

10. Múltiplos perfis (vários CNPJs/clientes).
11. Bloqueador de anúncios/tracking (o `interceptor.js` já existe — é só estender).
12. Auto-update (Squirrel/electron-updater) — sem isso, distribuir patches de segurança é manual.
13. Sincronização de favoritos/histórico.

---

## Resumo executivo

- **Pare tudo e corrija** `setCertificateVerifyProc` e `setPermissionRequestHandler` — hoje o browser é *menos* seguro que o Chrome, justo no caso de uso fiscal.
- **Maior ganho visual com menor esforço:** unificar ícones em um set SVG e domar o uso do vermelho.
- **Nome:** trocar "CFBrowser" por algo que diga "autenticação oficial brasileira" (Rúbrica/Chancela). Pelo menos preencher `productName`.
- **Primeira feature a construir:** gerenciador de downloads + impressão (PDF). É o que o público sente falta no dia 1.

---

## Próximos passos sugeridos

- [ ] Corrigir validação de certificado TLS (`main.js`)
- [ ] Corrigir handler de permissões (`main.js`)
- [ ] Unificar ícones em SVG
- [ ] Extrair paleta para CSS custom properties
- [ ] Definir nome definitivo + `productName`
- [ ] Implementar gerenciador de downloads
- [ ] Implementar impressão / salvar PDF
- [ ] Autocomplete na barra de endereço
