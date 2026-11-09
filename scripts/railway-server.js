const fs = require('node:fs');
const { start } = require('./durable-server');

const volume = '/data';

function railwaySettings(env, mountInfo) {
  // mountinfo field 5 is the mount point. A directory on the root filesystem is not enough.
  const mounted = mountInfo.split('\n').some(line => line.split(' ')[4] === volume);
  if (env.RAILWAY_VOLUME_MOUNT_PATH !== volume || !mounted) {
    throw new Error('Attach a Railway volume at /data before starting the LockGuard cabinet.');
  }
  const domain = env.RAILWAY_PUBLIC_DOMAIN;
  if (!domain || !domain.includes('.') || new URL('https://' + domain).hostname !== domain.toLowerCase()) {
    throw new Error('Generate an HTTPS public domain for the Railway service.');
  }
  return {
    APP_URL: 'https://' + domain.toLowerCase(),
    LOCKGUARD_DURABLE_STORAGE: 'true',
    LOCKGUARD_DB_FILE: volume + '/lockguard.sqlite3',
    LOCKGUARD_BACKUP_DIR: volume + '/backups'
  };
}

async function main() {
  Object.assign(process.env, railwaySettings(process.env, fs.readFileSync('/proc/self/mountinfo', 'utf8')));
  await start();
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = { railwaySettings };
