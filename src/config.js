const path = require('node:path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function loadConfig() {
  const apiUrl = process.env.CLICKDRIVE_API_URL;
  const token = process.env.CLICKDRIVE_TOKEN;

  const missing = [];
  if (!apiUrl) missing.push('CLICKDRIVE_API_URL');
  if (!token) missing.push('CLICKDRIVE_TOKEN');

  if (missing.length > 0) {
    throw new Error(
      `Variaveis de ambiente ausentes: ${missing.join(', ')}. Copie .env.example para .env e preencha os valores.`
    );
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    token,
    concurrency: parseIntEnv('CLICKDRIVE_CONCURRENCY', 4, { min: 1 }),
    maxRetries: parseIntEnv('CLICKDRIVE_MAX_RETRIES', 3, { min: 0 }),
    retryBaseMs: parseIntEnv('CLICKDRIVE_RETRY_BASE_MS', 500, { min: 0 }),
    requestTimeoutMs: parseIntEnv('CLICKDRIVE_REQUEST_TIMEOUT_MS', 30000, { min: 1 }),
    resetState: process.env.CLICKDRIVE_RESET_STATE === 'true',
  };
}

function parseIntEnv(name, fallback, { min } = {}) {
  const parsed = Number.parseInt(process.env[name], 10);
  if (Number.isNaN(parsed)) return fallback;
  if (min !== undefined && parsed < min) return fallback;
  return parsed;
}

module.exports = { loadConfig };
