/**
 * Interceptor de requisições HTTP/HTTPS via webRequest API do Electron.
 * Permite logar todas as requests e aplicar regras de redirecionamento.
 */

/**
 * Configura a interceptação de requests na session fornecida.
 * @param {Electron.Session} session - A session do Electron a ser monitorada.
 * @param {Array<{from: string, to: string}>} rules - Regras de redirecionamento.
 */
function setupInterceptor(session, rules = []) {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const timestamp = new Date().toISOString();
    const method = details.method || 'GET';
    const url = details.url;

    console.log(`[${timestamp}] ${method} ${url}`);

    // Verificar se alguma regra de redirecionamento se aplica
    const match = rules.find((rule) => url.startsWith(rule.from));
    if (match) {
      const redirectURL = url.replace(match.from, match.to);
      console.log(`  -> Redirecionando para: ${redirectURL}`);
      callback({ redirectURL });
      return;
    }

    // Sem redirecionamento — deixar a request prosseguir normalmente
    callback({});
  });

  console.log(`[Interceptor] Ativo com ${rules.length} regra(s) de redirecionamento.`);
}

module.exports = { setupInterceptor };
