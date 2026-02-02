const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = __dirname;
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'uploads');
const NPCS_FILE = path.join(PROJECT_ROOT, 'npcs.json');

function slugify(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isImageFile(fileName) {
  return /(\.jpg|\.jpeg|\.png|\.gif|\.webp)$/i.test(fileName);
}

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function readNpcs() {
  if (!fs.existsSync(NPCS_FILE)) {
    throw new Error('Arquivo npcs.json não encontrado.');
  }
  const raw = fs.readFileSync(NPCS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveNpcs(npcs) {
  fs.writeFileSync(NPCS_FILE, JSON.stringify(npcs, null, 2), 'utf-8');
}

function copyImageToUploads(sourcePath, npcId) {
  const ext = path.extname(sourcePath).toLowerCase() || '.jpg';
  const destName = `${npcId}-${Date.now()}${ext}`;
  const destPath = path.join(UPLOAD_DIR, destName);
  fs.copyFileSync(sourcePath, destPath);
  return path.relative(PROJECT_ROOT, destPath).replace(/\\/g, '/');
}

function cleanupOldImage(oldPath) {
  if (!oldPath || oldPath.startsWith('http')) return;
  const absolute = path.join(PROJECT_ROOT, oldPath);
  if (absolute.startsWith(UPLOAD_DIR) && fs.existsSync(absolute)) {
    try {
      fs.unlinkSync(absolute);
    } catch (err) {
      console.warn(`Não foi possível remover o arquivo antigo ${absolute}:`, err.message);
    }
  }
}

function printUsage() {
  console.log('Uso: node bulk-import-images.js <pasta-com-imagens>');
  console.log('Cada arquivo deve estar nomeado com o ID ou nome do NPC (ex: alex_petrov.jpg).');
}

async function run() {
  const importDirArg = process.argv[2];
  if (!importDirArg) {
    printUsage();
    process.exit(1);
  }

  const importDir = path.resolve(PROJECT_ROOT, importDirArg);
  if (!fs.existsSync(importDir) || !fs.statSync(importDir).isDirectory()) {
    console.error('Diretório informado é inválido:', importDir);
    process.exit(1);
  }

  ensureUploadsDir();
  const npcs = readNpcs();
  const npcMap = new Map(npcs.map(npc => [npc.id, npc]));

  const files = fs.readdirSync(importDir).filter(file => isImageFile(file));
  if (files.length === 0) {
    console.log('Nenhum arquivo de imagem encontrado no diretório informado.');
    return;
  }

  let updated = 0;
  const skipped = [];
  const errors = [];

  for (const file of files) {
    const absolute = path.join(importDir, file);
    const baseName = path.basename(file, path.extname(file));
    const maybeId = slugify(baseName);

    if (!maybeId) {
      skipped.push({ file, reason: 'Não foi possível derivar um ID do nome do arquivo.' });
      continue;
    }

    const npc = npcMap.get(maybeId);
    if (!npc) {
      skipped.push({ file, reason: `Nenhum NPC com id "${maybeId}".` });
      continue;
    }

    try {
      const relativePath = copyImageToUploads(absolute, maybeId);
      const oldImage = npc.image;
      npc.image = relativePath;
      cleanupOldImage(oldImage);
      updated += 1;
      console.log(`✔ ${file} associado ao NPC ${npc.nome} (${npc.id}).`);
    } catch (err) {
      errors.push({ file, reason: err.message });
      console.error(`✖ Erro ao importar ${file}:`, err.message);
    }
  }

  if (updated > 0) {
    saveNpcs(npcs);
  }

  console.log('\nResumo da importação:');
  console.log(`  NPCs atualizados: ${updated}`);
  console.log(`  Arquivos ignorados: ${skipped.length}`);
  console.log(`  Erros: ${errors.length}`);

  if (skipped.length) {
    console.log('\nIgnorados:');
    skipped.forEach(item => console.log(`  - ${item.file}: ${item.reason}`));
  }

  if (errors.length) {
    console.log('\nFalhas:');
    errors.forEach(item => console.log(`  - ${item.file}: ${item.reason}`));
  }
}

run().catch(err => {
  console.error('Falha geral ao executar importação:', err);
  process.exit(1);
});
