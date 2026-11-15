const operationalStatus = require('./operational-status');

// Public aggregate only. Detailed diagnostics remain restricted to the owner.
module.exports = function healthCheck(db, initialize, env = process.env) {
  return async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let healthy = false;
    try {
      await initialize();
      healthy = db.getMeta('schema_version') === '1';
      if (healthy && env.LOCKGUARD_DURABLE_STORAGE === 'true' && env.LOCKGUARD_EPHEMERAL_DEMO !== 'true') {
        const operations = operationalStatus(db, env);
        healthy = operations.backupStatus === 'ok' && operations.driveBackup.status === 'ok' && operations.restoreStatus === 'ok';
      }
    } catch {
      // Exceptions can contain SQL, storage paths or provider credentials.
    }
    return res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'unavailable' });
  };
};
