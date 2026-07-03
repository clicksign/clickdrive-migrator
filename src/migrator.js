const fs = require('node:fs');
const path = require('node:path');

const { ApiError } = require('./clickdriveClient');
const { countFiles } = require('./discovery');

const DUPLICATED_FOLDER_NAME = 'duplicated';

class Migrator {
  constructor(client, logger) {
    this.client = client;
    this.logger = logger;
    this.stats = { foldersCreated: 0, filesUploaded: 0, filesFailed: 0, filesDuplicated: 0 };
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

    if (result.duplicated) {
      this.stats.filesDuplicated += countFiles(node);
      return;
    }

    for (const child of node.children) {
      await this.migrateNode(child, result.id);
    }
  }

  async createFolder(node, ancestorId) {
    try {
      const folder = await this.client.createFolder({ name: node.name, ancestorId });
      this.logger.info(`Pasta criada: "${node.name}" (id=${folder.id})`);
      this.stats.foldersCreated += 1;
      return { id: folder.id };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const destination = this.moveToDuplicated(node.absolutePath);
        this.logger.warn(
          `Duplicidade no ClickDrive ao criar pasta "${node.name}". Pasta local movida para "${destination}"; conteudo nao sera migrado nesta execucao.`
        );
        return { duplicated: true };
      }
      const skipped = countFiles(node);
      this.logger.error(`Falha ao criar pasta "${node.name}": ${err.message}. ${skipped} arquivo(s) dentro dela nao serao migrados.`);
      this.stats.filesFailed += skipped;
      return { duplicated: true };
    }
  }

  async uploadFile(node, ancestorId) {
    try {
      const file = await this.client.uploadFile({ filePath: node.absolutePath, name: node.name, ancestorId });
      this.logger.info(`Upload concluido: "${node.name}" (id=${file.id})`);
      this.stats.filesUploaded += 1;
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
