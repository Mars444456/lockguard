const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

async function restore(sourcePath, targetPath) {
  if (!sourcePath || !targetPath) throw new Error('Usage: node scripts/restore-db.js BACKUP.sqlite3 NEW_DATABASE.sqlite3');
  const sourceFile = path.resolve(sourcePath), targetFile = path.resolve(targetPath);
  if (sourceFile === targetFile || fs.existsSync(targetFile) || fs.existsSync(targetFile + '-wal') || fs.existsSync(targetFile + '-shm')) {
    throw new Error('Restore target must be a new path. Existing databases are never overwritten.');
  }
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup integrity check failed');
    if (source.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value !== '1') throw new Error('Unsupported backup schema');
    fs.mkdirSync(path.dirname(targetFile), { recursive: true, mode: 0o700 });
    fs.closeSync(fs.openSync(targetFile, 'wx', 0o600));
    await backup(source, targetFile);
    const restored = new DatabaseSync(targetFile);
    try { restored.exec('PRAGMA foreign_keys=ON; DELETE FROM sessions; DELETE FROM auth_limits;'); }
    finally { restored.close(); }
    fs.chmodSync(targetFile, 0o600);
    return targetFile;
  } finally { source.close(); }
}

if (require.main === module) restore(process.argv[2], process.argv[3])
  .then(file => console.log('Restored to ' + file + '. Set LOCKGUARD_DB_FILE to this path before starting the server. All browser sessions were revoked.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { restore };
