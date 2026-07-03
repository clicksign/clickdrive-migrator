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
  };
}

module.exports = { loadConfig };
