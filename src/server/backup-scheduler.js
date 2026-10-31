const path = require('node:path');

module.exports = function startBackups(db, env = process.env) {
  const hours = Number(env.LOCKGUARD_BACKUP_HOURS || 24);
  const retention = Number(env.LOCKGUARD_BACKUP_RETENTION || 7);
  if (!Number.isFinite(hours) || hours < 1 || hours > 8760 || !Number.isInteger(retention) || retention < 1 || retention > 100) {
    throw new Error('Backup interval must be 1–8760 hours and retention must be 1–100 files.');
  }
  const directory = env.LOCKGUARD_BACKUP_DIR || path.join(path.dirname(db.dbFilePath), 'backups');
  let pending = false;
  const run = async () => {
    if (pending) return;
    pending = true;
    try { await db.createBackup(directory, retention); console.log('LockGuard database backup verified.'); }
    catch (error) { console.error('LockGuard backup failed:', error.message); }
    finally { pending = false; }
  };
  const timer = setInterval(run, hours * 3600000);
  timer.unref();
  const last = Date.parse(db.getMeta('last_backup_at'));
  if (!Number.isFinite(last) || Date.now() - last >= hours * 3600000) void run();
  return () => clearInterval(timer);
};
