const test = require('node:test');
const assert = require('node:assert/strict');
const healthCheck = require('../src/server/health-check');
const drive = require('../src/server/drive-backup');

async function invoke(handler, req = {}) {
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, response);
  return response;
}

test('Health checks read the database and initialize the analyzer without consuming credentials', async () => {
  let initialized = 0, reads = 0;
  const handler = healthCheck({ getMeta(key) { reads++; assert.equal(key, 'schema_version'); return '1'; } }, async () => { initialized++; }, {});
  const req = { headers: { cookie: 'private-session', authorization: 'private-token' } };
  Object.defineProperty(req, 'auth', { get() { throw new Error('Health must not inspect account state'); } });
  const response = await invoke(handler, req);
  assert.equal(initialized, 1); assert.equal(reads, 1);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body, { status: 'ok' });
});

test('Database or analyzer failure returns a private 503 and a successful retry recovers', async () => {
  for (const failure of ['database', 'analyzer', 'schema']) {
    let failed = true;
    const handler = healthCheck({ getMeta() {
      if (failed && failure === 'database') throw new Error('private-sql-token@example.invalid');
      return failed && failure === 'schema' ? 'unexpected' : '1';
    } }, async () => {
      if (failed && failure === 'analyzer') throw new Error('private-sql-token@example.invalid');
    }, {});
    let response = await invoke(handler);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { status: 'unavailable' });
    failed = false;
    response = await invoke(handler);
    assert.equal(response.statusCode, 200);
  }
});

test('Durable health rejects failed or stale copies and restore drills, then recovers', async () => {
  const now = Date.now(), at = hours => new Date(now - hours * 3600000).toISOString();
  const env = {
    LOCKGUARD_DURABLE_STORAGE: 'true', LOCKGUARD_BACKUP_KEY: 'synthetic-key',
    LOCKGUARD_BACKUP_HOURS: '16', LOCKGUARD_BACKUP_MAX_AGE_HOURS: '24',
    LOCKGUARD_BACKUP_DRIVE_FOLDER: 'test-folder-a', LOCKGUARD_BACKUP_DRIVE_CLIENT_ID: 'test.apps.googleusercontent.com',
    LOCKGUARD_BACKUP_DRIVE_CLIENT_SECRET: 'synthetic-secret', LOCKGUARD_BACKUP_DRIVE_TOKEN: '{"refresh_token":"synthetic-token"}'
  };
  const remote = { destination: drive.settings(env).destination, status: 'ok', lastSuccessAt: at(18) };
  const meta = { schema_version: '1', last_backup_status: 'ok', last_backup_at: at(18),
    last_restore_status: 'ok', last_restore_verified_at: at(1), [drive.META_KEY]: JSON.stringify(remote) };
  const db = { getMeta: key => meta[key], recovery: { configured: () => false }, emailVerification: { configured: () => false } };
  const handler = healthCheck(db, async () => {}, env);
  assert.equal((await invoke(handler)).statusCode, 200, 'Mail setup is separate from operational health');
  for (const [key, value] of [
    ['last_backup_status', 'failed'], ['last_backup_status', 'incomplete'], ['last_backup_status', 'unexpected'], ['last_backup_status', undefined],
    ['last_backup_at', at(25)], ['last_restore_status', 'failed'], ['last_restore_status', 'incomplete'], ['last_restore_verified_at', at(8 * 24)],
    [drive.META_KEY, JSON.stringify({ ...remote, status: 'failed' })],
    [drive.META_KEY, JSON.stringify({ ...remote, lastSuccessAt: at(25) })], [drive.META_KEY, 'invalid']
  ]) {
    const previous = meta[key]; meta[key] = value;
    const response = await invoke(handler);
    assert.equal(response.statusCode, 503, key);
    assert.deepEqual(response.body, { status: 'unavailable' });
    meta[key] = previous;
    assert.equal((await invoke(handler)).statusCode, 200, 'Healthy evidence restores the signal');
  }
  delete env.LOCKGUARD_BACKUP_DRIVE_TOKEN;
  assert.equal((await invoke(handler)).statusCode, 503);
  env.LOCKGUARD_EPHEMERAL_DEMO = 'true';
  assert.equal((await invoke(handler)).statusCode, 200, 'The temporary demo checks application health without claiming durable readiness');
});
