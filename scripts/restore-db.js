const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const sqliteSuffixes = ['', '-journal', '-wal', '-shm'];

function assertNewTarget(sourceFile, targetFile) {
  if (sourceFile === targetFile || sqliteSuffixes.some(suffix => fs.lstatSync(targetFile + suffix, { throwIfNoEntry: false }))) {
    throw new Error('Restore target must be a new path. Existing databases are never overwritten.');
  }
}

async function restore(sourcePath, targetPath) {
  if (!sourcePath || !targetPath) throw new Error('Usage: node scripts/restore-db.js BACKUP.sqlite3 NEW_DATABASE.sqlite3');
  const sourceFile = path.resolve(sourcePath), targetFile = path.resolve(targetPath);
  assertNewTarget(sourceFile, targetFile);
  const readable = await require('../src/server/backup-crypto').plaintext(sourceFile);
  let stagingDirectory, stagedFile;
  try {
    let source;
    try {
      source = new DatabaseSync(readable.file, { readOnly: true });
      if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup integrity check failed');
      if (source.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value !== '1') throw new Error('Unsupported backup schema');
      const destination = path.dirname(targetFile);
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      stagingDirectory = fs.mkdtempSync(path.join(destination, '.lockguard-restore-'));
      stagedFile = path.join(stagingDirectory, 'restore.sqlite3');
      fs.closeSync(fs.openSync(stagedFile, 'wx', 0o600));
      await backup(source, stagedFile);
    } finally {
      try { source?.close(); }
      finally { readable.cleanup(); }
    }

    const restored = new DatabaseSync(stagedFile);
    try {
      // Publish a single SQLite file, with all revocations committed to that file.
      if (restored.prepare('PRAGMA journal_mode=DELETE').get().journal_mode !== 'delete') throw new Error('Cannot prepare standalone SQLite restore');
      restored.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM auth_limits;');
      for (const table of ['workspace_invites', 'recovery_tokens', 'email_verification_tokens']) {
        if (restored.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) restored.exec('DELETE FROM ' + table);
      }
      restored.exec('COMMIT');
    } finally { restored.close(); }
    fs.chmodSync(stagedFile, 0o600);
    assertNewTarget(sourceFile, targetFile);
    // link() publishes atomically and fails if another restore has claimed the path.
    fs.linkSync(stagedFile, targetFile);
    return targetFile;
  } finally {
    if (stagingDirectory) {
      for (const suffix of sqliteSuffixes) fs.rmSync(stagedFile + suffix, { force: true });
      fs.rmdirSync(stagingDirectory);
    }
  }
}

if (require.main === module) restore(process.argv[2], process.argv[3])
  .then(file => console.log('Restored to ' + file + '. Set LOCKGUARD_DB_FILE to this path before starting the server. All browser sessions were revoked.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { restore };
