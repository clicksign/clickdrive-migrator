const fs = require('node:fs');
const path = require('node:path');

const { DUPLICATED_FOLDER_NAME } = require('./constants');

function discover(inputPath, { ignoredAbsolutePaths = [], onSymlinkSkipped } = {}) {
  const absolutePath = path.resolve(inputPath);
  const ignoredSet = new Set(ignoredAbsolutePaths);
  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    return { type: 'file', name: path.basename(absolutePath), absolutePath };
  }

  if (stat.isDirectory()) {
    return buildFolderNode(absolutePath, ignoredSet, onSymlinkSkipped);
  }

  throw new Error(`Caminho nao e um arquivo nem uma pasta: ${absolutePath}`);
}

function buildFolderNode(absolutePath, ignoredSet, onSymlinkSkipped) {
  const entries = fs.readdirSync(absolutePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  const children = [];
  for (const entry of entries) {
    const entryPath = path.join(absolutePath, entry.name);

    // "duplicated" e reservado para o fluxo de conflito e pode aparecer em qualquer
    // profundidade da arvore; os diretorios gerados pelo script (logs, checkpoint) sao
    // sempre relativos ao cwd, entao sao ignorados so pelo caminho absoluto exato -
    // nunca pelo nome, que poderia colidir com uma pasta legitima do usuario.
    if (entry.isDirectory() && (entry.name === DUPLICATED_FOLDER_NAME || ignoredSet.has(entryPath))) continue;

    if (entry.isDirectory()) {
      children.push(buildFolderNode(entryPath, ignoredSet, onSymlinkSkipped));
    } else if (entry.isFile()) {
      children.push({ type: 'file', name: entry.name, absolutePath: entryPath });
    } else if (entry.isSymbolicLink() && onSymlinkSkipped) {
      onSymlinkSkipped(entryPath);
    }
  }

  return { type: 'folder', name: path.basename(absolutePath), absolutePath, children };
}

function countFiles(node) {
  if (node.type === 'file') return 1;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

module.exports = { discover, countFiles };
