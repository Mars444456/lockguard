const path = require('node:path');
const drive = require('./drive-backup');
const MAX_TIMER_DELAY = 2147483647;
const HOUR = 3600000;

module.exports = function startBackups(db, env = process.env) {
  const hours = Number(env.LOCKGUARD_BACKUP_HOURS || 24);
  const retention = Number(env.LOCKGUARD_BACKUP_RETENTION || 7);
  if (!Number.isFinite(hours) || hours < 1 || hours > 8760 || !Number.isInteger(retention) || retention < 1 || retention > 100) {
    throw new Error('Backup interval must be 1–8760 hours and retention must be 1–100 files.');
  }
  const directory = env.LOCKGUARD_BACKUP_DIR || path.join(path.dirname(db.dbFilePath), 'backups');
  const interval = hours * HOUR;
  const last = Date.parse(db.getMeta('last_backup_at'));
  const now = Date.now();
  let dueAt = Number.isFinite(last) && last <= now && db.getMeta('last_backup_status') !== 'failed' ? last + interval : now;
  const destination = drive.settings(env);
  let remote = drive.readState(db, destination.destination);
  if (destination.destination) {
    const lastCopy = Date.parse(remote.lastSuccessAt);
    const lastAttempt = Date.parse(remote.lastAttemptAt);
    const remoteDueAt = remote.status === 'ok' && Number.isFinite(lastCopy) && lastCopy <= now
      ? lastCopy + interval
      : remote.status === 'failed' && Number.isFinite(lastAttempt) && lastAttempt <= now
        ? lastAttempt + HOUR : now;
    dueAt = Math.min(dueAt, remoteDueAt);
  }
  let timer, stopped = false;
  const recordRemote = values => {
    remote = { ...remote, ...values };
    db.setMeta(drive.META_KEY, JSON.stringify(remote));
  };
  const transfer = async file => {
    try {
      recordRemote({ status: 'incomplete', lastAttemptAt: new Date().toISOString() });
      await drive.upload(file, destination);
      if (!stopped) recordRemote({ status: 'ok', lastSuccessAt: new Date().toISOString() });
      console.log('LockGuard encrypted backup copied to Google Drive.');
    } catch {
      if (!stopped) {
        try { recordRemote({ status: 'failed', lastFailureAt: new Date().toISOString() }); } catch {}
      }
      console.error('LockGuard external backup failed. Check Drive access and the external backup status.');
      return false;
    }
    return true;
  };
  const schedule = () => {
    if (stopped) return;
    // Node turns delays above 2^31-1 into 1 ms. Wait in bounded chunks instead.
    timer = setTimeout(run, Math.min(MAX_TIMER_DELAY, Math.max(1, Math.ceil(dueAt - Date.now()))));
    timer.unref();
  };
  const run = async () => {
    if (stopped) return;
    if (Date.now() < dueAt) { schedule(); return; }
    let delay = interval;
    try {
      const file = await db.createBackup(directory, retention);
      console.log('LockGuard database backup verified.');
      if (!stopped && destination.destination && !await transfer(file)) delay = HOUR;
    }
    catch { console.error('LockGuard backup failed. Check backup diagnostics and local storage configuration.'); }
    finally {
      // Schedule only after completion: slow or failed attempts cannot overlap or spin.
      dueAt = Date.now() + delay;
      schedule();
    }
  };
  if (dueAt <= now) void run(); else schedule();
  return () => { stopped = true; clearTimeout(timer); };
};
