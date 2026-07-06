const fs = require('node:fs');
const path = require('node:path');

const { ApiError } = require('./clickdriveClient');
const { countFiles } = require('./discovery');
const { ConcurrencyLimiter } = require('./concurrencyLimiter');
const { withRetry } = require('./retry');

const DUPLICATED_FOLDER_NAME = 'duplicated';

class Migrator {
  constructor(client, logger, checkpoint, { concurrency = 4, maxRetries = 3, retryBaseMs = 500 } = {}) {
    this.client = client;
    this.logger = logger;
    this.checkpoint = checkpoint;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
    this.limiter = new ConcurrencyLimiter(concurrency);
    this.stats = {
      foldersCreated: 0,
      foldersResumed: 0,
      filesUploaded: 0,
      filesResumed: 0,
      filesFailed: 0,
      filesDuplicated: 0,
    };
  }

  async run(rootNode) {
    await this.migrateNode(rootNode, null);
    return this.stats;
  }

  async migrateNode(node, ancestorId) {
    if (node.type === 'file') {
      await this.uploadFile(node, ancestorId);
      return;
    }

    const result = await this.createFolder(node, ancestorId);

    if (result.skip) {
      return;
    }

    await Promise.all(node.children.map((child) => this.migrateNode(child, result.id)));
  }

  callWithLimits(name, fn) {
    return this.limiter.run(() =>
      withRetry(fn, {
        retries: this.maxRetries,
        baseDelayMs: this.retryBaseMs,
        onRetry: (attempt, retries, err, delayMs) => {
          this.logger.warn(`Tentativa ${attempt}/${retries} falhou para "${name}" (${err.message}). Nova tentativa em ${delayMs}ms.`);
        },
      })
    );
  }

  async createFolder(node, ancestorId) {
    const cached = this.checkpoint.get(node.absolutePath);
    if (cached) {
      this.logger.info(`Pasta ja migrada em execucao anterior (retomada): "${node.name}" (id=${cached.id})`);
      this.stats.foldersResumed += 1;
      return { id: cached.id };
    }

    try {
      const folder = await this.callWithLimits(node.name, () => this.client.createFolder({ name: node.name, ancestorId }));
      this.logger.info(`Pasta criada: "${node.name}" (id=${folder.id})`);
      this.stats.foldersCreated += 1;
      this.checkpoint.record({ path: node.absolutePath, type: 'folder', id: folder.id });
      return { id: folder.id };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const destination = this.moveToDuplicated(node.absolutePath);
        this.logger.warn(
          `Duplicidade no ClickDrive ao criar pasta "${node.name}". Pasta local movida para "${destination}"; conteudo nao sera migrado nesta execucao.`
        );
        this.stats.filesDuplicated += countFiles(node);
        return { skip: true };
      }
      const skipped = countFiles(node);
      this.logger.error(`Falha ao criar pasta "${node.name}": ${err.message}. ${skipped} arquivo(s) dentro dela nao serao migrados.`);
      this.stats.filesFailed += skipped;
      return { skip: true };
    }
  }

  async uploadFile(node, ancestorId) {
    if (this.checkpoint.has(node.absolutePath)) {
      this.logger.info(`Arquivo ja migrado em execucao anterior (retomado): "${node.name}"`);
      this.stats.filesResumed += 1;
      return;
    }

    try {
      const file = await this.callWithLimits(node.name, () =>
        this.client.uploadFile({ filePath: node.absolutePath, name: node.name, ancestorId })
      );
      this.logger.info(`Upload concluido: "${node.name}" (id=${file.id})`);
      this.stats.filesUploaded += 1;
      this.checkpoint.record({ path: node.absolutePath, type: 'file', id: file.id });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const destination = this.moveToDuplicated(node.absolutePath);
        this.logger.warn(`Duplicidade no ClickDrive ao enviar arquivo "${node.name}". Arquivo movido localmente para "${destination}".`);
        this.stats.filesDuplicated += 1;
      } else {
        this.logger.error(`Falha ao enviar "${node.name}": ${err.message}`);
        this.stats.filesFailed += 1;
      }
    }
  }

  moveToDuplicated(absolutePath) {
    const duplicatedDir = path.join(path.dirname(absolutePath), DUPLICATED_FOLDER_NAME);
    fs.mkdirSync(duplicatedDir, { recursive: true });
    const destination = path.join(duplicatedDir, path.basename(absolutePath));
    fs.renameSync(absolutePath, destination);
    return destination;
  }
}

module.exports = { Migrator };
