const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { previewSettings } = require('./preview-server');

function cloudSettings(inherited, runtime) {
  if (!inherited.RENDER_EXTERNAL_URL) throw new Error('RENDER_EXTERNAL_URL is required for the isolated cloud demo.');
  const port = Number(inherited.PORT || '10000');
  return { ...previewSettings(inherited.RENDER_EXTERNAL_URL, runtime, port, inherited), LOCKGUARD_EPHEMERAL_DEMO: 'true' };
}

function start() {
  cloudSettings(process.env, '.');
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-cloud-demo-'));
  fs.chmodSync(runtime, 0o700);
  const settings = cloudSettings(process.env, runtime);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, settings);
  process.chdir(runtime);
  const server = require('../src/server/server');
  const db = require('../src/server/db');
  const stopBackups = require('../src/server/backup-scheduler')(db);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    stopBackups();
    const deadline = setTimeout(() => process.exit(1), 8000); deadline.unref();
    server.close(() => { db.close(); process.exit(0); });
    server.closeIdleConnections();
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  server.once('error', error => { stopBackups(); db.close(); console.error(error.message); process.exitCode = 1; });
  server.listen(Number(settings.PORT), '0.0.0.0', () => console.log('Isolated, temporary LockGuard demo: ' + settings.APP_URL));
}

if (require.main === module) {
  try { start(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { cloudSettings };
