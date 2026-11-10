const test = require('node:test');
const assert = require('node:assert/strict');
const startBackups = require('../src/server/backup-scheduler');
const drive = require('../src/server/drive-backup');

const HOUR = 3600000;
const MAX_DELAY = 2147483647;
const NOW = Date.parse('2026-01-01T00:00:00Z');
const settle = () => new Promise(resolve => setImmediate(resolve));

function clock(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  // MockTimers accepts oversized delays; enforce the real Node timer contract too.
  for (const name of ['setTimeout', 'setInterval']) {
    const original = global[name];
    t.mock.method(global, name, (callback, delay, ...args) => {
      assert.ok(delay >= 1 && delay <= MAX_DELAY, 'Delay must fit a Node timer');
      return original(callback, delay, ...args);
    });
  }
}

function database(last, status = 'ok', copy = async () => {}) {
  const meta = { last_backup_at: last, last_backup_status: status };
  const calls = [];
  return {
    dbFilePath: 'synthetic.sqlite3', calls,
    getMeta: key => meta[key],
    setMeta: (key, value) => { meta[key] = value; },
    async createBackup() {
      calls.push(Date.now());
      try {
        const file = await copy();
        meta.last_backup_at = new Date().toISOString();
        meta.last_backup_status = 'ok';
        return file;
      } catch (error) { meta.last_backup_status = 'failed'; throw error; }
    }
  };
}

test('Restart preserves the deadline of the last successful backup', async t => {
  clock(t);
  const db = database(new Date(NOW - 23 * HOUR).toISOString());
  let stop = startBackups(db); t.after(() => stop());
  t.mock.timers.tick(HOUR / 2);
  assert.equal(db.calls.length, 0);
  stop(); stop = startBackups(db);
  t.mock.timers.tick(HOUR / 2 - 1);
  assert.equal(db.calls.length, 0);
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(db.calls, [NOW + HOUR]);
  t.mock.timers.tick(24 * HOUR - 1);
  assert.equal(db.calls.length, 1);
  t.mock.timers.tick(1); await settle();
  assert.equal(db.calls.length, 2);
});

test('A one-year interval stays within Node timer limits and does not run early', async t => {
  clock(t);
  const db = database(new Date(NOW).toISOString());
  const stop = startBackups(db, { LOCKGUARD_BACKUP_HOURS: '8760' }); t.after(stop);
  let remaining = 8760 * HOUR;
  while (remaining > MAX_DELAY) {
    t.mock.timers.tick(MAX_DELAY); remaining -= MAX_DELAY;
    assert.equal(db.calls.length, 0);
  }
  t.mock.timers.tick(remaining - 1);
  assert.equal(db.calls.length, 0);
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(db.calls, [NOW + 8760 * HOUR]);
});

test('Missing, stale, invalid, future and failed backup evidence triggers a startup attempt', async t => {
  clock(t);
  for (const [last, status] of [
    [null, 'ok'], [new Date(NOW - 24 * HOUR).toISOString(), 'ok'],
    ['invalid', 'ok'], [new Date(NOW + HOUR).toISOString(), 'ok'],
    [new Date(NOW).toISOString(), 'failed']
  ]) {
    const db = database(last, status);
    const stop = startBackups(db); t.after(stop);
    await settle(); assert.equal(db.calls.length, 1, String(last) + ' / ' + status);
    stop();
  }
});

test('A failed attempt retries at the configured interval and then resumes successful backups', async t => {
  clock(t);
  let fail = true;
  const db = database(null, 'ok', async () => { if (fail) throw new Error('synthetic failure'); });
  const stop = startBackups(db, { LOCKGUARD_BACKUP_HOURS: '1' }); t.after(stop);
  await settle(); assert.equal(db.calls.length, 1);
  t.mock.timers.tick(HOUR - 1); assert.equal(db.calls.length, 1);
  fail = false;
  t.mock.timers.tick(1); await settle(); assert.equal(db.calls.length, 2);
  t.mock.timers.tick(HOUR); await settle(); assert.equal(db.calls.length, 3);
});

test('A pending backup never overlaps another attempt or re-arms after stop', async t => {
  clock(t);
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const db = database(null, 'ok', () => pending);
  const stop = startBackups(db, { LOCKGUARD_BACKUP_HOURS: '1' }); t.after(stop);
  t.mock.timers.tick(3 * HOUR); assert.equal(db.calls.length, 1);
  stop(); stop(); finish(); await settle();
  t.mock.timers.tick(3 * HOUR); assert.equal(db.calls.length, 1);
});

test('A slow backup schedules the next attempt from completion', async t => {
  clock(t);
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const db = database(null, 'ok', () => pending);
  const stop = startBackups(db, { LOCKGUARD_BACKUP_HOURS: '1' }); t.after(stop);
  t.mock.timers.tick(3.5 * HOUR); assert.equal(db.calls.length, 1);
  finish(); await settle();
  t.mock.timers.tick(HOUR - 1); assert.equal(db.calls.length, 1);
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(db.calls, [NOW, NOW + 4.5 * HOUR]);
});

test('Stopping a scheduled backup prevents it from running', async t => {
  clock(t);
  const db = database(new Date(NOW).toISOString());
  const stop = startBackups(db); stop();
  t.mock.timers.tick(48 * HOUR); await settle();
  assert.equal(db.calls.length, 0);
});

test('External backup runs after a restart with a fresh local copy and retries independently', async t => {
  clock(t);
  const env = {
    LOCKGUARD_BACKUP_KEY: 'synthetic-key',
    LOCKGUARD_BACKUP_DRIVE_TOKEN: '{"refresh_token":"synthetic-token"}',
    LOCKGUARD_BACKUP_DRIVE_CLIENT_ID: 'test.apps.googleusercontent.com',
    LOCKGUARD_BACKUP_DRIVE_CLIENT_SECRET: 'synthetic-secret',
    LOCKGUARD_BACKUP_DRIVE_FOLDER: 'test-folder-a',
    LOCKGUARD_BACKUP_HOURS: '24'
  };
  const db = database(new Date(NOW).toISOString(), 'ok', async () => 'synthetic.sqlite3.enc');
  let rejectUpload = true;
  const upload = t.mock.method(drive, 'upload', async (file, destination) => {
    assert.equal(file, 'synthetic.sqlite3.enc');
    assert.equal(destination.folder, env.LOCKGUARD_BACKUP_DRIVE_FOLDER);
    if (rejectUpload) throw new Error('synthetic transfer failure');
  });
  let stop = startBackups(db, env);
  t.after(() => stop());
  await settle();
  assert.equal(db.getMeta('last_backup_status'), 'ok');
  const failed = drive.status(db, env, Date.now(), 24 * HOUR);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.lastSuccessAt, null);
  assert.doesNotMatch(JSON.stringify(failed), /synthetic-token|test-folder-a|synthetic-secret/);

  rejectUpload = false;
  stop();
  stop = startBackups(db, env);
  t.mock.timers.tick(HOUR - 1);
  assert.equal(upload.mock.callCount(), 1);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(upload.mock.callCount(), 2);
  assert.equal(drive.status(db, env, Date.now(), 24 * HOUR).status, 'ok');
  assert.equal(drive.status(db, env, Date.now() + 25 * HOUR, 24 * HOUR).status, 'overdue');
  assert.equal(drive.status(db, { ...env, LOCKGUARD_BACKUP_DRIVE_FOLDER: 'test-folder-b' }, Date.now(), 24 * HOUR).status, 'never');
  assert.equal(drive.status(db, { ...env, LOCKGUARD_BACKUP_DRIVE_TOKEN: '' }, Date.now(), 24 * HOUR).status, 'misconfigured');
});
