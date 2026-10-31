const db = require('../src/server/db');

db.createBackup(process.env.LOCKGUARD_BACKUP_DIR, Number(process.env.LOCKGUARD_BACKUP_RETENTION || 7))
  .then(file => console.log('Verified backup: ' + file))
  .catch(error => { console.error('Backup failed: ' + error.message); process.exitCode = 1; })
  .finally(() => db.close());
