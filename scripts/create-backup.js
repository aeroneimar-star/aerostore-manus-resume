const fs = require('fs');
const path = require('path');
const { blockProduction, warnLocalOnly } = require('./scriptSafety');

blockProduction('create-backup.js');
warnLocalOnly('create-backup.js');

const projectRoot = path.resolve(__dirname, '..');
const backupsRoot = path.join(projectRoot, '_backups');
const timestamp = formatTimestamp(new Date());
const backupRoot = path.join(backupsRoot, `${timestamp}-aerostore-system`);
const includeWhatsAppSession = process.argv.includes('--include-whatsapp-session');
const includeCampaignMedia = process.argv.includes('--include-campaign-media');

const manifest = {
  createdAt: new Date().toISOString(),
  backupName: path.basename(backupRoot),
  nodeVersion: process.version,
  includeWhatsAppSession,
  includeCampaignMedia,
  includedEntries: [],
  ignoredEntries: [],
  totals: {
    files: 0,
    directories: 0,
    bytes: 0,
    approximateSize: '0 B',
  },
  warnings: [
    'Este backup nao inclui .env por padrao.',
    'Sessoes do WhatsApp ficam fora por padrao e so entram com --include-whatsapp-session.',
    'Campaign media pesada fica fora por padrao e so entra com --include-campaign-media.',
    'Revise segredos e tokens antes de compartilhar este pacote.',
  ],
};

const ignoredPaths = new Set([
  'node_modules',
  '.env',
  '.wwebjs_auth',
  '.wwebjs_cache',
  '_backups',
  '_recovery_backups',
  'data/whatsapp-sessions',
  'data/whatsapp-browser',
  'data/campaign-media',
]);

const ignoredExportNamePatterns = [/^tmp/i, /^runtime/i, /^server/i];

const rootFiles = [
  'package.json',
  'package-lock.json',
  'server.js',
  'db.js',
  'README.md',
  'AGENTS.md',
  '.env.example',
  'start-aerostore.bat',
  'start-aerostore.sh',
  'DEPLOY_MULTI_INSTANCE.md',
  'DISCOVERY_WHATSAPP_MOTOR.md',
  'STATUS-ESTAVEL-WHATSAPP.md',
  'skills-lock.json',
];

const codeDirs = ['public', 'modules', 'services', 'config', 'scripts'];
const dataDirs = ['data/pdv', 'data/imports', 'data/test-media'];
const uploadDirs = ['data/uploads'];
const databaseFiles = ['data/aerostore-crm.sqlite'];
const optionalExportExtensions = new Set(['.csv', '.xlsx', '.xls', '.json', '.txt']);

main();

function main() {
  ensureDir(backupsRoot);
  ensureDir(backupRoot);
  ensureDir(path.join(backupRoot, 'code'));
  ensureDir(path.join(backupRoot, 'data'));
  ensureDir(path.join(backupRoot, 'database'));
  ensureDir(path.join(backupRoot, 'uploads'));

  registerDefaultIgnoredEntries();

  copyRootFiles();
  copyCodeDirectories();
  copyDataDirectories();
  copyUploadDirectories();
  copyDatabaseFiles();
  copyUsefulDataExports();

  if (includeCampaignMedia) {
    copyPath('data/campaign-media', path.join(backupRoot, 'uploads', 'campaign-media'));
  } else {
    registerIgnored('data/campaign-media');
  }

  if (includeWhatsAppSession) {
    copyOptionalWhatsAppSessions();
  } else {
    registerIgnored('.wwebjs_auth');
    registerIgnored('.wwebjs_cache');
    registerIgnored('data/whatsapp-sessions');
    registerIgnored('data/whatsapp-browser');
  }

  manifest.totals.approximateSize = formatBytes(manifest.totals.bytes);

  const readmePath = path.join(backupRoot, 'README-backup.txt');
  fs.writeFileSync(readmePath, buildBackupReadme(), 'utf8');

  const manifestPath = path.join(backupRoot, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(backupRoot);
}

function copyRootFiles() {
  const destinationRoot = path.join(backupRoot, 'code', 'root');
  ensureDir(destinationRoot);
  for (const relativePath of rootFiles) {
    copyPath(relativePath, path.join(destinationRoot, path.basename(relativePath)));
  }
}

function copyCodeDirectories() {
  for (const relativePath of codeDirs) {
    copyPath(relativePath, path.join(backupRoot, 'code', path.basename(relativePath)));
  }
}

function copyDataDirectories() {
  for (const relativePath of dataDirs) {
    copyPath(relativePath, path.join(backupRoot, 'data', path.basename(relativePath)));
  }
}

function copyUploadDirectories() {
  for (const relativePath of uploadDirs) {
    copyPath(relativePath, path.join(backupRoot, 'uploads', path.basename(relativePath)));
  }
}

function copyDatabaseFiles() {
  for (const relativePath of databaseFiles) {
    copyPath(relativePath, path.join(backupRoot, 'database', path.basename(relativePath)));
  }
}

function copyUsefulDataExports() {
  const dataRoot = path.join(projectRoot, 'data');
  if (!fs.existsSync(dataRoot)) {
    return;
  }

  const exportsRoot = path.join(backupRoot, 'data', 'exports');
  ensureDir(exportsRoot);

  for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!optionalExportExtensions.has(extension)) {
      continue;
    }

    if (entry.name.endsWith('.log') || ignoredExportNamePatterns.some((pattern) => pattern.test(entry.name))) {
      continue;
    }

    copyPath(path.join('data', entry.name), path.join(exportsRoot, entry.name));
  }
}

function copyOptionalWhatsAppSessions() {
  const sensitiveRoot = path.join(backupRoot, 'sensitive-whatsapp-session');
  ensureDir(sensitiveRoot);
  copyPath('.wwebjs_auth', path.join(sensitiveRoot, '.wwebjs_auth'), true);
  copyPath('.wwebjs_cache', path.join(sensitiveRoot, '.wwebjs_cache'), true);
  copyPath('data/whatsapp-sessions', path.join(sensitiveRoot, 'whatsapp-sessions'), true);
  copyPath('data/whatsapp-browser', path.join(sensitiveRoot, 'whatsapp-browser'), true);
}

function copyPath(relativeSource, destination, forceInclude = false) {
  const normalizedRelative = normalizeRelative(relativeSource);
  const source = path.join(projectRoot, normalizedRelative);

  if (!fs.existsSync(source)) {
    registerIgnored(`${normalizedRelative} (ausente)`);
    return;
  }

  if (!forceInclude && isIgnored(normalizedRelative)) {
    registerIgnored(normalizedRelative);
    return;
  }

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    ensureDir(destination);
    manifest.includedEntries.push(normalizedRelative);
    copyDirectoryRecursive(source, destination, normalizedRelative, forceInclude);
    return;
  }

  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  registerFileCopy(normalizedRelative, stat.size);
}

function copyDirectoryRecursive(sourceDir, destinationDir, baseRelative, forceInclude = false) {
  manifest.totals.directories += 1;

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const relativePath = normalizeRelative(path.join(baseRelative, entry.name));

    if (!forceInclude && isIgnored(relativePath)) {
      registerIgnored(relativePath);
      continue;
    }

    if (entry.isDirectory()) {
      const nextDestination = path.join(destinationDir, entry.name);
      ensureDir(nextDestination);
      copyDirectoryRecursive(sourcePath, nextDestination, relativePath, forceInclude);
      continue;
    }

    const destinationPath = path.join(destinationDir, entry.name);
    const stat = fs.statSync(sourcePath);
    fs.copyFileSync(sourcePath, destinationPath);
    registerFileCopy(relativePath, stat.size);
  }
}

function registerFileCopy(relativePath, size) {
  manifest.totals.files += 1;
  manifest.totals.bytes += size;
  manifest.includedEntries.push(normalizeRelative(relativePath));
}

function buildBackupReadme() {
  return [
    'AEROSTORE backup local',
    '',
    `Pasta: ${path.basename(backupRoot)}`,
    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    '',
    'Conteudo padrao:',
    '- code/: codigo principal e configuracoes nao sensiveis',
    '- data/: dados operacionais e exports uteis',
    '- database/: banco SQLite local',
    '- uploads/: uploads operacionais essenciais',
    '- manifest.json: manifesto tecnico do backup',
    '',
    'Exclusoes padrao:',
    '- node_modules',
    '- .env',
    '- .wwebjs_auth',
    '- .wwebjs_cache',
    '- data/whatsapp-sessions',
    '- data/whatsapp-browser',
    '- data/campaign-media',
    '',
    'Opcoes explicitas:',
    '- Para incluir sessao do WhatsApp, rode: node scripts/create-backup.js --include-whatsapp-session',
    '- Para incluir campaign media pesada, rode: node scripts/create-backup.js --include-campaign-media',
    '',
    'Aviso:',
    '- Revise este pacote antes de compartilhar.',
    '- Segredos e tokens devem continuar protegidos.',
  ].join('\n');
}

function registerDefaultIgnoredEntries() {
  registerIgnored('node_modules');
  registerIgnored('.env');
  registerIgnored('_backups');
  registerIgnored('_recovery_backups');
  if (!includeCampaignMedia) {
    registerIgnored('data/campaign-media');
  }
  if (!includeWhatsAppSession) {
    registerIgnored('.wwebjs_auth');
    registerIgnored('.wwebjs_cache');
    registerIgnored('data/whatsapp-sessions');
    registerIgnored('data/whatsapp-browser');
  }
}

function isIgnored(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (includeCampaignMedia && (normalized === 'data/campaign-media' || normalized.startsWith('data/campaign-media/'))) {
    return false;
  }
  if (includeWhatsAppSession) {
    if (normalized === '.wwebjs_auth' || normalized.startsWith('.wwebjs_auth/')) {
      return false;
    }
    if (normalized === '.wwebjs_cache' || normalized.startsWith('.wwebjs_cache/')) {
      return false;
    }
    if (normalized === 'data/whatsapp-sessions' || normalized.startsWith('data/whatsapp-sessions/')) {
      return false;
    }
    if (normalized === 'data/whatsapp-browser' || normalized.startsWith('data/whatsapp-browser/')) {
      return false;
    }
  }

  for (const ignored of ignoredPaths) {
    if (normalized === ignored || normalized.startsWith(`${ignored}/`)) {
      return true;
    }
  }
  return false;
}

function registerIgnored(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!manifest.ignoredEntries.includes(normalized)) {
    manifest.ignoredEntries.push(normalized);
  }
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function normalizeRelative(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function formatTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
