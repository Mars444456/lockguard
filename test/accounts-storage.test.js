require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-sqlite-'));
process.env.LOCKGUARD_DB_FILE = path.join(tmp, 'main.sqlite3');
const main = require('../src/server/db');
const { PersistentDatabase } = main;
const { restore } = require('../scripts/restore-db');
const connections = [main];
const open = options => { const db = new PersistentDatabase(options); connections.push(db); return db; };
test.after(() => { for (const db of connections) db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('SQLite scopes keys, history, organization settings and orders to their owners', () => {
  const db = open({ memoryOnly: true });
  const alice = db.createAccount({ email: 'alice@example.invalid', passwordHash: 'test-hash', organizationName: 'Alice' });
  const bob = db.createAccount({ email: 'bob@example.invalid', passwordHash: 'test-hash', organizationName: 'Bob' });
  const a = db.forOrganization(alice.organizationId), b = db.forOrganization(bob.organizationId);
  const key = a.createApiKey('Alice CI');
  a.addRun({ repo: 'alice/private', organizationId: bob.organizationId, id: 'spoofed' });
  assert.equal(b.getApiKeys().length, 0);
  assert.equal(b.getRuns().length, 0);
  assert.equal(b.revokeApiKey(key.id), false);
  assert.equal(b.verifyApiKey(key.key), false);
  assert.equal(db.verifyApiKey(key.key).organizationId, alice.organizationId);
  assert.notEqual(a.getRuns()[0].id, 'spoofed');
  assert.equal(a.getRuns()[0].organizationId, alice.organizationId);
  const product = require('../src/server/payment-catalog').team;
  const order = a.createPaymentOrder({ product, email: alice.email, requestId: 'same-request', testMode: true, merchantLogin: 'test' });
  const other = b.createPaymentOrder({ product, email: bob.email, requestId: 'same-request', testMode: true, merchantLogin: 'test' });
  assert.notEqual(order.id, other.id);
  assert.equal(b.getPaymentOrder(order.id), undefined);
  assert.throws(() => b.completePaymentOrder(order.id), /organization mismatch/);
  a.updateOrganization({ name: 'Changed Alice', id: bob.organizationId });
  assert.equal(a.getOrganization().id, alice.organizationId);
  assert.equal(b.getOrganization().name, 'Bob');
});

test('Legacy migration preserves profiles, key IDs, run order and paid order replay state', () => {
  const source = path.join(tmp, 'legacy.json');
  const original = { organization: { id: 'legacy-org', name: 'Existing team', plan: 'team', accessUntil: '2099-01-01T00:00:00.000Z' },
    apiKeys: [{ id: 'old-key', key: 'legacy-secret-12345', status: 'active' }],
    runs: [{ id: 'newer', repo: 'existing/new' }, { id: 'older', repo: 'existing/old' }],
    paymentOrders: [{ id: '123', requestId: 'legacy-request', organizationId: 'legacy-org', productId: 'team', status: 'paid', amount: '1500.00' }], lastInvoiceId: 123 };
  fs.writeFileSync(source, JSON.stringify(original));
  const db = open({ dbFilePath: source });
  assert.equal(db.getOrganization().name, 'Existing team');
  assert.equal(db.getApiKeys()[0].id, 'old-key');
  assert.equal(db.verifyApiKey('legacy-secret-12345').id, 'old-key');
  assert.deepEqual(db.getRuns().map(run => run.id), ['newer', 'older']);
  assert.equal(db.getPaymentOrder('123').status, 'paid');
  assert.equal(db.completePaymentOrder('123').status, 'paid');
  assert.deepEqual(JSON.parse(fs.readFileSync(source)), original);
  const reopened = open({ dbFilePath: source });
  assert.equal(reopened.getRuns().length, 2, 'Migration must not run twice');
  assert.equal(reopened.getPaymentOrders().length, 1);
});

test('Database errors roll back account creation and all related records', () => {
  const db = open({ memoryOnly: true });
  const fields = { email: 'unique@example.invalid', passwordHash: 'hash', organizationName: 'Unique' };
  db.createAccount(fields);
  assert.throws(() => db.createAccount(fields), /Unable to save/);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM users').get().n, 1);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM organizations').get().n, 2, 'No orphan organization from failed signup');
});

test('Concurrent connections commit every increment without stale file overwrites', async () => {
  const db = open({ dbFilePath: path.join(tmp, 'concurrent.sqlite3') });
  assert.equal(db.sql.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  const modulePath = path.resolve(__dirname, '../src/server/db');
  const code = `const {workerData,parentPort}=require('node:worker_threads'); process.env.LOCKGUARD_DB_FILE=workerData.file;
    const main=require(workerData.modulePath); for(let i=0;i<20;i++) main.recordCheck(); main.close(); parentPort.postMessage('done');`;
  await Promise.all([1, 2].map(() => new Promise((resolve, reject) => {
    const worker = new Worker(code, { eval: true, workerData: { file: db.dbFilePath, modulePath } });
    worker.on('error', reject); worker.on('exit', exit => exit === 0 ? resolve() : reject(new Error('Worker failed: ' + exit)));
  })));
  assert.equal(db.getOrganization().checksUsedThisMonth, 40);
});

test('Backups restore account and organization data, revoke sessions and never overwrite a database', async () => {
  const db = open({ dbFilePath: path.join(tmp, 'backed.sqlite3') });
  const user = db.createAccount({ email: 'backup@example.invalid', passwordHash: 'hashed-password', organizationName: 'Backup team' });
  const token = db.createSession(user.id);
  const store = db.forOrganization(user.organizationId);
  const key = store.createApiKey('Backed CI');
  store.addRun({ repo: 'backup/private' });
  const folder = path.join(tmp, 'backups');
  const file = await db.createBackup(folder, 2);
  store.clearRuns();
  const target = path.join(tmp, 'restored.sqlite3');
  await restore(file, target);
  const restored = open({ dbFilePath: target });
  assert.equal(restored.getSession(token), null);
  assert.equal(restored.getUserByEmail(user.email).passwordHash, 'hashed-password');
  assert.equal(restored.forOrganization(user.organizationId).getRuns()[0].repo, 'backup/private');
  assert.equal(restored.verifyApiKey(key.key).organizationId, user.organizationId);
  await assert.rejects(restore(file, target), /new path/);
  await db.createBackup(folder, 2);
  await db.createBackup(folder, 2);
  assert.equal(fs.readdirSync(folder).filter(name => name.endsWith('.sqlite3')).length, 2);
  assert.ok(db.getMeta('last_backup_at'));
});

test('Sessions expire, logout revokes them, and password changes invalidate old credentials atomically', () => {
  const db = open({ memoryOnly: true });
  const user = db.createAccount({ email: 'session@example.invalid', passwordHash: 'old-hash', organizationName: 'Sessions' });
  const first = db.createSession(user.id), second = db.createSession(user.id);
  assert.equal(db.getSession(first).id, user.id);
  assert.ok(!JSON.stringify(db.sql.prepare('SELECT * FROM sessions').all()).includes(first));
  db.deleteSession(first);
  assert.equal(db.getSession(first), null);
  db.changePassword(user.id, 'new-hash', 'old-hash');
  assert.equal(db.getSession(second), null);
  assert.throws(() => db.createSession(user.id, 'old-hash'), error => error.statusCode === 401);
  assert.throws(() => db.changePassword(user.id, 'hijacked', 'old-hash'), error => error.statusCode === 401);
  const active = db.createSession(user.id, 'new-hash');
  db.sql.prepare('UPDATE sessions SET expires_at=0').run();
  assert.equal(db.getSession(active), null);
});
