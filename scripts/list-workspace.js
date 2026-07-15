// Script auxiliar de teste: lista a arvore de pastas/arquivos do workspace no Click.Drive
// via GET /api/v1/workspace e imprime de forma estruturada (estilo `tree`).
//
// Uso:
//   node scripts/list-workspace.js                  -> lista a arvore inteira a partir da raiz
//   node scripts/list-workspace.js <ancestor_id>     -> lista a arvore a partir de uma pasta especifica
//
// Usa as mesmas variaveis de ambiente do migrador (.env): CLICKDRIVE_API_URL, CLICKDRIVE_TOKEN.

const { loadConfig } = require('../src/config');
const { ClickDriveClient } = require('../src/clickdriveClient');

async function fetchAllNodes(client, ancestorId) {
  const nodes = [];
  let cursor;

  do {
    const page = await client.listWorkspace({ ancestorId, cursor });
    nodes.push(...page.nodes);
    cursor = page.next_cursor;
  } while (cursor);

  return nodes;
}

async function buildTree(client, ancestorId) {
  const nodes = await fetchAllNodes(client, ancestorId);
  nodes.sort((a, b) => a.name.localeCompare(b.name));

  const children = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      children.push({ ...node, children: await buildTree(client, node.id) });
    } else {
      children.push(node);
    }
  }
  return children;
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return ` (${bytes}B)`;
  if (bytes < 1024 * 1024) return ` (${(bytes / 1024).toFixed(1)}KB)`;
  return ` (${(bytes / (1024 * 1024)).toFixed(1)}MB)`;
}

function printTree(nodes, prefix = '') {
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const label = node.type === 'folder' ? `${node.name}/` : `${node.name}${formatSize(node.size)}`;
    console.log(`${prefix}${branch}${label}`);

    if (node.type === 'folder') {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      printTree(node.children, childPrefix);
    }
  });
}

function countNodes(nodes) {
  let folders = 0;
  let files = 0;
  for (const node of nodes) {
    if (node.type === 'folder') {
      folders += 1;
      const counts = countNodes(node.children);
      folders += counts.folders;
      files += counts.files;
    } else {
      files += 1;
    }
  }
  return { folders, files };
}

async function main(argv) {
  const ancestorId = argv[2];

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  const client = new ClickDriveClient(config);

  console.log(ancestorId ? `Raiz (ancestor_id=${ancestorId})` : 'Workspace (raiz)');
  try {
    const tree = await buildTree(client, ancestorId);
    printTree(tree);
    const { folders, files } = countNodes(tree);
    console.log(`\n${folders} pasta(s), ${files} arquivo(s).`);
  } catch (err) {
    console.error(`Falha ao listar o workspace: ${err.message}`);
    return 1;
  }

  return 0;
}

main(process.argv).then((code) => process.exit(code));
