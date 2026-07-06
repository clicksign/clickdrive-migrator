const path = require('node:path');
const fs = require('node:fs');

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { discover } = require('./discovery');
const { ClickDriveClient } = require('./clickdriveClient');
const { Migrator } = require('./migrator');
const { STATE_DIR_NAME, stateFilePathFor, loadCheckpoint, CheckpointStore, resetCheckpoint } = require('./checkpoint');

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

  const logsDir = path.resolve(process.cwd(), 'logs');
  const stateDir = path.join(process.cwd(), STATE_DIR_NAME);

  const logger = createLogger(logsDir);

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
    rootNode = discover(absoluteInputPath, { ignoredAbsolutePaths: [logsDir, stateDir] });
  } catch (err) {
    logger.error(`Falha ao descobrir arquivos: ${err.message}`);
    return 1;
  }

  const stateFilePath = stateFilePathFor(absoluteInputPath);

  if (config.resetState) {
    resetCheckpoint(stateFilePath);
    logger.info('CLICKDRIVE_RESET_STATE=true: checkpoint anterior descartado, migracao comecara do zero.');
  }

  const existingEntries = loadCheckpoint(stateFilePath);
  if (existingEntries.size > 0) {
    logger.info(`Checkpoint encontrado: retomando migracao (${existingEntries.size} item(ns) ja migrados em execucao anterior serao pulados).`);
  }
  const checkpoint = new CheckpointStore(stateFilePath, existingEntries);

  const client = new ClickDriveClient(config);
  const migrator = new Migrator(client, logger, checkpoint, {
    concurrency: config.concurrency,
    maxRetries: config.maxRetries,
    retryBaseMs: config.retryBaseMs,
  });

  let stats;
  try {
    stats = await migrator.run(rootNode);
  } catch (err) {
    logger.error(`Migracao interrompida por erro inesperado: ${err.message}`);
    return 1;
  }

  logger.info(
    `Migracao finalizada. Pastas criadas: ${stats.foldersCreated} (retomadas: ${stats.foldersResumed}). Arquivos enviados: ${stats.filesUploaded} (retomados: ${stats.filesResumed}). Duplicados (movidos localmente): ${stats.filesDuplicated}. Falhas: ${stats.filesFailed}. Log completo em ${logger.filePath}`
  );

  return stats.filesFailed > 0 ? 1 : 0;
}

module.exports = { main };
