const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STATE_DIR_NAME = '.clickdrive-migrator-state';

function stateFilePathFor(rootAbsolutePath, cwd = process.cwd()) {
  const hash = crypto.createHash('sha256').update(rootAbsolutePath).digest('hex').slice(0, 16);
  return path.join(cwd, STATE_DIR_NAME, `${hash}.jsonl`);
}

function loadCheckpoint(stateFilePath) {
  const entries = new Map();
  if (!fs.existsSync(stateFilePath)) return entries;

  const lines = fs.readFileSync(stateFilePath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      entries.set(entry.path, entry);
    } catch {
      // ignora linha corrompida (ex: escrita interrompida por queda de energia/processo)
    }
  }
  return entries;
}

class CheckpointStore {
  constructor(stateFilePath, initialEntries = new Map()) {
    this.stateFilePath = stateFilePath;
    this.entries = initialEntries;
    fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
  }

  has(absolutePath) {
    return this.entries.has(absolutePath);
  }

  get(absolutePath) {
    return this.entries.get(absolutePath);
  }

  record(entry) {
    this.entries.set(entry.path, entry);
    fs.appendFileSync(this.stateFilePath, `${JSON.stringify(entry)}\n`);
  }
}

function resetCheckpoint(stateFilePath) {
  if (fs.existsSync(stateFilePath)) {
    fs.rmSync(stateFilePath);
  }
}

module.exports = { STATE_DIR_NAME, stateFilePathFor, loadCheckpoint, CheckpointStore, resetCheckpoint };
