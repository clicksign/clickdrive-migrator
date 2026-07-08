const path = require('node:path');

const { ApiError } = require('./clickdriveClient');
const { countFiles } = require('./discovery');
const { ConcurrencyLimiter } = require('./concurrencyLimiter');
const { withRetry } = require('./retry');
const { DUPLICATED_FOLDER_NAME } = require('./constants');

// Numero maximo de filhos de uma mesma pasta processados de uma vez durante a travessia.
// Independente do limite de requisicoes simultaneas (this.limiter), evita criar milhares
// de Promises pendentes de uma vez em pastas muito largas.
const TRAVERSAL_BATCH_SIZE = 200;

class Migrator {
  constructor(client, logger, checkpoint, { concurrency = 4, maxRetries = 3, retryBaseMs = 500 } = {}) {
    this.client = client;
    this.logger = logger;
    this.checkpoint = checkpoint;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
    this.limiter = new ConcurrencyLimiter(concurrency);
    this.duplicatedFolderPromises = new Map();
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

    await this.migrateChildren(node.children, result.id);
  }

  async migrateChildren(children, ancestorId) {
    for (let i = 0; i < children.length; i += TRAVERSAL_BATCH_SIZE) {
      const batch = children.slice(i, i + TRAVERSAL_BATCH_SIZE);
      await Promise.all(batch.map((child) => this.migrateNode(child, ancestorId)));
    }
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
        try {
          const duplicatedId = await this.getOrCreateDuplicatedFolder(node.absolutePath, ancestorId);
          const folder = await this.callWithLimits(node.name, () =>
            this.client.createFolder({ name: node.name, ancestorId: duplicatedId })
          );
          this.logger.warn(
            `Duplicidade no ClickDrive ao criar pasta "${node.name}". Pasta criada dentro de "${DUPLICATED_FOLDER_NAME}" no ClickDrive (id=${folder.id}).`
          );
          this.stats.filesDuplicated += countFiles(node);
          this.checkpoint.record({ path: node.absolutePath, type: 'folder', id: folder.id });
          return { id: folder.id };
        } catch (dupErr) {
          const skipped = countFiles(node);
          this.logger.error(
            `Duplicidade no ClickDrive ao criar pasta "${node.name}", mas falha ao criar em "${DUPLICATED_FOLDER_NAME}" no ClickDrive: ${dupErr.message}. ${skipped} arquivo(s) dentro dela nao serao migrados.`
          );
          this.stats.filesFailed += skipped;
          return { skip: true };
        }
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
        try {
          const duplicatedId = await this.getOrCreateDuplicatedFolder(node.absolutePath, ancestorId);
          const file = await this.callWithLimits(node.name, () =>
            this.client.uploadFile({ filePath: node.absolutePath, name: node.name, ancestorId: duplicatedId })
          );
          this.logger.warn(
            `Duplicidade no ClickDrive ao enviar arquivo "${node.name}". Arquivo enviado para "${DUPLICATED_FOLDER_NAME}" no ClickDrive (id=${file.id}).`
          );
          this.stats.filesDuplicated += 1;
          this.checkpoint.record({ path: node.absolutePath, type: 'file', id: file.id });
        } catch (dupErr) {
          this.logger.error(
            `Duplicidade no ClickDrive ao enviar arquivo "${node.name}", mas falha ao enviar para "${DUPLICATED_FOLDER_NAME}" no ClickDrive: ${dupErr.message}.`
          );
          this.stats.filesFailed += 1;
        }
      } else {
        this.logger.error(`Falha ao enviar "${node.name}": ${err.message}`);
        this.stats.filesFailed += 1;
      }
    }
  }

  // Chave sintetica (nunca colide com um node real: "duplicated" e um nome
  // reservado que a descoberta local ja ignora) usada tanto para cache em
  // memoria durante a execucao atual quanto para retomada via checkpoint.
  getOrCreateDuplicatedFolder(absolutePath, ancestorId) {
    const key = path.join(path.dirname(absolutePath), DUPLICATED_FOLDER_NAME);

    const cached = this.checkpoint.get(key);
    if (cached) return Promise.resolve(cached.id);

    if (!this.duplicatedFolderPromises.has(key)) {
      const promise = this.createOrFindDuplicatedFolder(key, ancestorId).catch((err) => {
        this.duplicatedFolderPromises.delete(key);
        throw err;
      });
      this.duplicatedFolderPromises.set(key, promise);
    }

    return this.duplicatedFolderPromises.get(key);
  }

  async createOrFindDuplicatedFolder(key, ancestorId) {
    try {
      const folder = await this.callWithLimits(DUPLICATED_FOLDER_NAME, () =>
        this.client.createFolder({ name: DUPLICATED_FOLDER_NAME, ancestorId })
      );
      this.checkpoint.record({ path: key, type: 'folder', id: folder.id });
      return folder.id;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const existingId = await this.findChildIdByName(ancestorId, DUPLICATED_FOLDER_NAME);
        if (existingId) {
          this.checkpoint.record({ path: key, type: 'folder', id: existingId });
          return existingId;
        }
      }
      throw err;
    }
  }

  async findChildIdByName(ancestorId, name) {
    let cursor;
    do {
      const page = await this.callWithLimits(`listWorkspace:${name}`, () => this.client.listWorkspace({ ancestorId, cursor }));
      const match = page.nodes.find((n) => n.type === 'folder' && n.name === name);
      if (match) return match.id;
      cursor = page.next_cursor;
    } while (cursor);
    return null;
  }
}

module.exports = { Migrator };
