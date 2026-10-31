const fs = require('node:fs');
const path = require('node:path');

function previewSettings(address, directory, port = 3001, inherited = process.env) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Укажите корневой HTTPS-адрес тестового туннеля без пароля и параметров.');
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Тестовый порт должен быть от 1024 до 65535.');
  // Keep OS essentials; never inherit production tokens, database paths or Node flags.
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|lang|lc_.*|tz)$/i.test(key)));
  return Object.assign(env, {
    NODE_ENV: 'production', PORT: String(port), APP_URL: url.origin,
    LOCKGUARD_DB_FILE: path.join(directory, 'test.sqlite3'),
    LOCKGUARD_BACKUP_DIR: path.join(directory, 'backups'),
    LOCKGUARD_BACKUP_HOURS: '24', LOCKGUARD_BACKUP_RETENTION: '3',
    LOCKGUARD_ALLOW_REGISTRATION: 'true',
    LOCKGUARD_TRUST_PROXY_IPS: '127.0.0.1,::1,::ffff:127.0.0.1',
    ROBOKASSA_TEST_MODE: 'true'
  });
}

function start(address, port = 3001) {
  if (!address) throw new Error('Запуск: npm run preview:server -- https://ВАШ-АДРЕС.trycloudflare.com [порт]');
  // Validate before creating files or loading the server's .env reader.
  previewSettings(address, '.', port);
  const root = path.resolve(__dirname, '..');
  const privateRoot = path.join(root, 'private');
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const runtime = fs.mkdtempSync(path.join(privateRoot, 'public-test-'));
  fs.chmodSync(runtime, 0o700);
  const env = previewSettings(address, runtime, port);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  process.chdir(runtime); // No project .env is read; this is a new directory.
  const server = require('../src/server/server');
  const db = require('../src/server/db');
  const stopBackups = require('../src/server/backup-scheduler')(db);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    stopBackups();
    const deadline = setTimeout(() => process.exit(1), 8000);
    deadline.unref();
    server.close(() => { db.close(); process.exit(0); });
    server.closeIdleConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  server.once('error', error => { stopBackups(); db.close(); console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log('Тестовый LockGuard: ' + env.APP_URL + '/#account');
    console.log('Отдельная тестовая база: ' + runtime);
    console.log('Основная база и .env проекта не используются. Ctrl+C — остановить.');
  });
}

if (require.main === module) {
  try { start(process.argv[2], process.argv[3] ? Number(process.argv[3]) : 3001); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { previewSettings };
