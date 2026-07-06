const { ApiError } = require('./clickdriveClient');

function isRetryable(err) {
  if (err instanceof ApiError) {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  // fetch/undici sinaliza qualquer falha de rede (DNS, conexao recusada, timeout,
  // socket resetado) como TypeError com essa mensagem exata. Erros de programacao
  // (TypeError por bug interno, validacao, etc.) nao devem ser reenviados.
  return err instanceof TypeError && err.message === 'fetch failed';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { retries = 3, baseDelayMs = 500, onRetry } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || attempt >= retries) {
        throw err;
      }
      const delayMs = baseDelayMs * 2 ** attempt;
      attempt += 1;
      if (onRetry) onRetry(attempt, retries, err, delayMs);
      await sleep(delayMs);
    }
  }
}

module.exports = { withRetry, isRetryable };
