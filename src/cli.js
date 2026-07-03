const path = require('node:path');
const fs = require('node:fs');

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { discover } = require('./discovery');
const { ClickDriveClient } = require('./clickdriveClient');
const { Migrator } = require('./migrator');

async function main(argv) {
  const inputPath = argv[2];

  if (!inputPath) {
    console.error('Uso: node script-main.js <caminho-local>');
    return 1;
  }

  const absoluteInputPath = path.resolve(inputPath);
  if (!fs.existsSync(absoluteInputPath)) {
    console.error(`Caminho nao encontrado: ${absoluteInputPath}`);
    return 1;
  }

  const logger = createLogger(path.resolve(process.cwd(), 'logs'));

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error(err.message);
    return 1;
  }

  logger.info(`Iniciando migracao de "${absoluteInputPath}"`);

  let rootNode;
  try {
    rootNode = discover(absoluteInputPath);
  } catch (err) {
    logger.error(`Falha ao descobrir arquivos: ${err.message}`);
    return 1;
  }

  const client = new ClickDriveClient(config);
  const migrator = new Migrator(client, logger);

  let stats;
  try {
    stats = await migrator.run(rootNode);
  } catch (err) {
    logger.error(`Migracao interrompida por erro inesperado: ${err.message}`);
    return 1;
  }

  logger.info(
    `Migracao finalizada. Pastas criadas: ${stats.foldersCreated}. Arquivos enviados: ${stats.filesUploaded}. Duplicados (movidos localmente): ${stats.filesDuplicated}. Falhas: ${stats.filesFailed}. Log completo em ${logger.filePath}`
  );

  return stats.filesFailed > 0 ? 1 : 0;
}

module.exports = { main };
