/**
 * Stealth preload — injetado em TODA <webview> via 'will-attach-webview' (main.js).
 *
 * Roda no main world da página (contextIsolation:false) ANTES de qualquer script
 * do site, em document_start.
 *
 * FILOSOFIA: o Chromium do Electron já reporta valores REAIS e CONSISTENTES
 * (GPU, CPU, plugins, etc.). Sobrescrevê-los em JS deixa "marcas de adulteração"
 * detectáveis (ex.: getParameter.toString() deixaria de ser "[native code]"),
 * o que PIORA a avaliação de bots em reCAPTCHA/hCaptcha.
 *
 * Por isso, quase tudo é resolvido nativamente fora deste arquivo:
 *   - navigator.webdriver  → false nativo via switch disable-blink-features=AutomationControlled
 *   - User-Agent / Client Hints → limpos na sessão (main.js), sem token "Electron"
 *   - navigator.languages  → via switch --lang=pt-BR
 *   - WebGL / CPU / memória / plugins → valores reais do Chromium (não tocar!)
 *
 * Aqui só corrigimos o que o Electron REALMENTE não tem e o Chrome tem:
 * o objeto window.chrome. E fazemos de forma aditiva (sem sobrescrever nada nativo).
 */

(function applyStealth() {
  'use strict';

  // window.chrome existe em todo Chrome real, mas não no Electron.
  // Adição simples (não é override de propriedade nativa).
  try {
    if (typeof window.chrome === 'undefined') {
      window.chrome = {};
    }
    if (typeof window.chrome.runtime === 'undefined') {
      // Em páginas comuns (sem extensão), chrome.runtime existe porém quase vazio.
      Object.defineProperty(window.chrome, 'runtime', {
        value: {}, writable: true, enumerable: true, configurable: true,
      });
    }
  } catch (_) { /* não impedir o carregamento da página */ }
})();
