const path = require('node:path');
const MAX_TIMER_DELAY = 2147483647;

module.exports = function startBackups(db, env = process.env) {
  const hours = Number(env.LOCKGUARD_BACKUP_HOURS || 24);
  const retention = Number(env.LOCKGUARD_BACKUP_RETENTION || 7);
  if (!Number.isFinite(hours) || hours < 1 || hours > 8760 || !Number.isInteger(retention) || retention < 1 || retention > 100) {
    throw new Error('Backup interval must be 1–8760 hours and retention must be 1–100 files.');
  }
  const directory = env.LOCKGUARD_BACKUP_DIR || path.join(path.dirname(db.dbFilePath), 'backups');
  const interval = hours * 3600000;
  const last = Date.parse(db.getMeta('last_backup_at'));
  const now = Date.now();
  let dueAt = Number.isFinite(last) && last <= now && db.getMeta('last_backup_status') !== 'failed' ? last + interval : now;
  let timer, stopped = false;
  const schedule = () => {
    if (stopped) return;
    // Node turns delays above 2^31-1 into 1 ms. Wait in bounded chunks instead.
    timer = setTimeout(run, Math.min(MAX_TIMER_DELAY, Math.max(1, Math.ceil(dueAt - Date.now()))));
    timer.unref();
  };
  const run = async () => {
    if (stopped) return;
    if (Date.now() < dueAt) { schedule(); return; }
    try { await db.createBackup(directory, retention); console.log('LockGuard database backup verified.'); }
    catch { console.error('LockGuard backup failed. Check backup diagnostics and local storage configuration.'); }
    finally {
      // Schedule only after completion: slow or failed attempts cannot overlap or spin.
      dueAt = Date.now() + interval;
      schedule();
    }
  };
  if (dueAt <= now) void run(); else schedule();
  return () => { stopped = true; clearTimeout(timer); };
};
