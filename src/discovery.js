const fs = require('node:fs');
const path = require('node:path');

function discover(inputPath) {
  const absolutePath = path.resolve(inputPath);
  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    return { type: 'file', name: path.basename(absolutePath), absolutePath };
  }

  if (stat.isDirectory()) {
    return buildFolderNode(absolutePath);
  }

  throw new Error(`Caminho nao e um arquivo nem uma pasta: ${absolutePath}`);
}

function buildFolderNode(absolutePath) {
  const entries = fs.readdirSync(absolutePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  const children = [];
  for (const entry of entries) {
    const entryPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      children.push(buildFolderNode(entryPath));
    } else if (entry.isFile()) {
      children.push({ type: 'file', name: entry.name, absolutePath: entryPath });
    }
  }

  return { type: 'folder', name: path.basename(absolutePath), absolutePath, children };
}

function countFiles(node) {
  if (node.type === 'file') return 1;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

module.exports = { discover, countFiles };
