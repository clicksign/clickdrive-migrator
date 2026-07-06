const fs = require('node:fs');
const path = require('node:path');

function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const fileName = `migration-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  const filePath = path.join(logDir, fileName);

  function write(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    if (level === 'ERROR') {
      console.error(line);
    } else {
      console.log(line);
    }
    fs.appendFileSync(filePath, line + '\n');
  }

  return {
    filePath,
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
  };
}

module.exports = { createLogger };
