const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const backupCrypto = require('../src/server/backup-crypto');
const { restore } = require('./restore-db');

const temporaryTables = ['sessions', 'session_workspaces', 'auth_limits', 'workspace_invites', 'recovery_tokens', 'email_verification_tokens'];

async function verifyBackup(file, { requireEncrypted = false } = {}) {
  let source, target, readable, temp, verifiedTables;
  try {
    // Compare against the same authenticated snapshot that was restored.
    readable = await backupCrypto.plaintext(file, undefined, { requireEncrypted });
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-restore-drill-'));
    const restored = await restore(readable.file, path.join(temp, 'restored.sqlite3'));
    source = new DatabaseSync(readable.file, { readOnly: true });
    target = new DatabaseSync(restored, { readOnly: true });
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(row => row.name).filter(name => name !== 'metadata' && !temporaryTables.includes(name));
    for (const name of tables) {
      if (!/^[a-z_]+$/.test(name)) throw new Error('Unexpected backup table');
      const checksum = connection => crypto.createHash('sha256')
        .update(JSON.stringify(connection.prepare('SELECT * FROM ' + name).all().map(row => JSON.stringify(row)).sort())).digest('hex');
      if (checksum(source) !== checksum(target)) throw new Error('Restored records differ from the verified backup');
    }
    for (const name of temporaryTables) {
      if (target.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) &&
          target.prepare('SELECT count(*) AS n FROM ' + name).get().n !== 0) {
        throw new Error('Restore retained temporary credentials');
      }
    }
    verifiedTables = tables.length;
  } finally {
    // Try each cleanup even if closing another handle or removing plaintext failed.
    let failure;
    for (const clean of [
      () => source?.close(),
      () => target?.close(),
      () => readable?.cleanup(),
      () => {
        if (!temp) return;
        const resolved=path.resolve(temp);
        if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('lockguard-restore-drill-'))throw new Error('Invalid drill cleanup directory');
        fs.rmSync(resolved,{recursive:true,force:true});
      }
    ]) {
      try { clean(); }
      catch (error) { failure ||= error; }
    }
    if (failure) throw failure;
  }
  return { verifiedAt: new Date().toISOString(), verifiedTables, sessionsRevoked: true, temporaryCredentialsRevoked: true };
}

async function verifyRestore(db, directory) {
  const record = values => db.transaction(() => {
    for (const [key, value] of Object.entries(values)) db.setMeta(key, value);
  });
  try {
    record({ last_restore_attempt_at: new Date().toISOString(), last_restore_status: 'incomplete' });
    const retention = Number(process.env.LOCKGUARD_BACKUP_RETENTION || 7);
    const result = await verifyBackup(await db.createBackup(directory, retention));
    record({ last_restore_verified_at: result.verifiedAt, last_restore_status: 'ok' });
    return result;
  } catch {
    try { record({ last_restore_failure_at: new Date().toISOString(), last_restore_status: 'failed' }); } catch {}
    throw new Error('Restore verification failed. Check backup diagnostics and local storage configuration.');
  }
}

async function main(args) {
  if (args.length === 0) {
    const db = require('../src/server/db');
    try { return await verifyRestore(db, process.env.LOCKGUARD_BACKUP_DIR); }
    finally { db.close(); }
  }
  if (args.length !== 2 || args[0] !== '--from' || !args[1].trim()) {
    throw new Error('Usage: npm run verify:restore [-- --from BACKUP.sqlite3.enc]');
  }
  try {
    const result = await verifyBackup(path.resolve(args[1]), { requireEncrypted: true });
    return { ...result, source: 'provided_encrypted_file' };
  } catch {
    throw new Error('Restore verification failed. Check the encrypted file, key and temporary storage.');
  }
}

if (require.main === module) main(process.argv.slice(2))
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verifyRestore };
