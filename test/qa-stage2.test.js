require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-stage2-'));
process.env.LOCKGUARD_DB_FILE = path.join(tmp, 'main.json');
delete process.env.DEFAULT_API_KEY;
const mainDatabase = require('../src/server/db');
const { PersistentDatabase } = mainDatabase;
const connections = [mainDatabase];
function openDatabase(options) { const db = new PersistentDatabase(options); connections.push(db); return db; }
const { RuleEngine, AutoSplitter } = require('../src/core');
const engine = new RuleEngine();
test.after(() => { for (const db of connections) db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('Unsupported SQL blocks release and cannot generate phases', () => {
  for (const sql of ["DO $$ BEGIN EXECUTE 'DROP TABLE users'; END $$;", 'CREATE TRIGGER x BEFORE INSERT ON users EXECUTE FUNCTION f();', 'SAVEPOINT s;', 'ALTER TABLE users RENAME TO old_users;']) {
    const result = engine.analyze(sql);
    assert.equal(result.passed, false);
    assert.equal(result.analysisComplete, false);
    assert.equal(result.isDmlOnly, false);
    assert.throws(() => AutoSplitter.generatePlan(result), /incomplete/);
  }
});
test('Truncated SQL is rejected', () => {
  for (const sql of ["SELECT 'unterminated", '/* missing end', 'DO $$ missing end']) assert.throws(() => engine.analyze(sql), /incomplete PostgreSQL/);
});
test('Partly unsupported ALTER TABLE cannot receive PASSED', () => {
  assert.throws(() => engine.analyze('SET lock_timeout=3000; ALTER TABLE users ADD COLUMN x int, RENAME COLUMN name TO old_name;'), SyntaxError);
});
test('Nested and inline block comments preserve the surrounding SQL', () => {
  const result = engine.analyze('SET lock_timeout=3000; /* outer /* nested */ still comment */ CREATE/**/INDEX ix ON users(id);');
  assert.ok(result.violations.some(v => v.ruleId === 'LG-002'));
});
test('Later CREATE TABLE cannot suppress earlier dangerous index', () => {
  const result = engine.analyze('SET lock_timeout=3000; CREATE INDEX ix ON users(id); CREATE TABLE users(id int);');
  assert.ok(result.violations.some(v => v.ruleId === 'LG-002'));
});
test('Secrets are shown once, stored hashed and remain revocable after restart', () => {
  const file = path.join(tmp, 'keys.json');
  const db = openDatabase({ dbFilePath: file });
  assert.equal(db.getApiKeys().length, 0);
  const created = db.createApiKey('CI');
  assert.ok(!fs.readFileSync(db.dbFilePath, 'utf8').includes(created.key));
  assert.ok(!JSON.stringify(db.getApiKeys()).includes(created.key));
  const reloaded = openDatabase({ dbFilePath: file });
  assert.ok(reloaded.verifyApiKey(created.key));
  reloaded.revokeApiKey(created.id);
  assert.equal(openDatabase({ dbFilePath: file }).verifyApiKey(created.key), false);
});
test('Legacy secrets migrate without losing IDs and demo key is revoked', () => {
  const file = path.join(tmp, 'legacy.json');
  fs.writeFileSync(file, JSON.stringify({ organization: {}, runs: [], apiKeys: [
    { id: 'a', key: 'old-real-secret', status: 'active' },
    { id: 'b', key: 'lg_live_demo998877665544332211', status: 'active' }
  ] }));
  const db = openDatabase({ dbFilePath: file });
  assert.ok(db.verifyApiKey('old-real-secret'));
  assert.equal(db.verifyApiKey('lg_live_demo998877665544332211'), false);
  assert.ok(!fs.readFileSync(db.dbFilePath, 'utf8').includes('old-real-secret'));
  assert.ok(fs.readFileSync(file, 'utf8').includes('old-real-secret'), 'Original recovery source is preserved');
  assert.ok(fs.readdirSync(tmp).some(name => name.startsWith('legacy.json.pre-sqlite-')));
});
test('Concurrent SQLite writers preserve independent updates and corrupt legacy input is retained', () => {
  const file = path.join(tmp, 'concurrent.json');
  const first = openDatabase({ dbFilePath: file });
  const second = openDatabase({ dbFilePath: file });
  second.updateOrganization({ name: 'Saved by second' });
  first.updateOrganization({ monthlyChecksQuota: 321 });
  assert.equal(first.getOrganization().name, 'Saved by second');
  assert.equal(second.getOrganization().monthlyChecksQuota, 321);
  const broken = path.join(tmp, 'broken.json');
  fs.writeFileSync(broken, '{broken');
  assert.throws(() => new PersistentDatabase({ dbFilePath: broken }), /Unable to load/);
  assert.equal(fs.readFileSync(broken, 'utf8'), '{broken');
});
test('Browser bundle matches server verdicts for dangerous and unsupported SQL', async () => {
  const sandbox = { window: {}, console, TextEncoder, TextDecoder, WebAssembly,
    URL, fetch: async () => new Response(fs.readFileSync(path.join(__dirname, '../docs/libpg-query.wasm')), { headers: { 'Content-Type': 'application/wasm' } }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/lockguard-engine.js'), 'utf8'), sandbox);
  await sandbox.window.LockGuard.ready;
  for (const sql of ['SET lock_timeout=3000; ALTER TABLE users ADD COLUMN bio text;', 'CREATE INDEX ix ON users(id);', 'DO $$ BEGIN NULL; END $$;']) {
    const browser = sandbox.window.LockGuard.analyze(sql);
    const server = engine.analyze(sql);
    assert.equal(browser.passed, server.passed);
    assert.equal(browser.violationsCount, server.violationsCount);
  }
});
test('Splitter retains original SQL and refuses to overwrite existing files', () => {
  const sql = 'SET lock_timeout=3000; CREATE INDEX ix ON users(id); SELECT 1;';
  const plan = AutoSplitter.generatePlan(engine.analyze(sql));
  assert.equal(plan.originalSql, sql);
  assert.equal(plan.requiresReview, true);
  AutoSplitter.writePhasesToDisk(plan, 'migration.sql', tmp);
  assert.throws(() => AutoSplitter.writePhasesToDisk(plan, 'migration.sql', tmp), /EEXIST/);
});
