require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-qa-'));
process.env.LOCKGUARD_DB_FILE = path.join(tmp, 'db.json');
process.env.LOCKGUARD_ADMIN_TOKEN = 'qa-admin-token';
const { RuleEngine, ContextAnalyzer } = require('../src/core');
const { PersistentDatabase } = require('../src/server/db');
const Billing = require('../src/server/billing-service');
const CLI = require('../src/cli/cli');
const engine = new RuleEngine();
test('QA conditional table creation does not prove the table is empty', () => {
  const result = engine.analyze('SET lock_timeout=3000; CREATE TABLE IF NOT EXISTS users(id int); CREATE INDEX ix ON users(id);');
  assert.ok(result.violations.some(v => v.ruleId === 'LG-002'));
});
test('QA suggested SQL preserves column types and complete unique index definition', () => {
  const { AutoSplitter } = require('../src/core');
  const result = engine.analyze('SET lock_timeout=3000; ALTER TABLE users ADD COLUMN token UUID DEFAULT gen_random_uuid();');
  assert.match(result.violations.find(v => v.ruleId === 'LG-001').safeFix, /ADD COLUMN token UUID/);
  assert.ok(AutoSplitter.generatePlan(result).phases.some(p => p.sql.includes('ADD COLUMN token UUID')));
  const index = engine.analyze('SET lock_timeout=3000; CREATE UNIQUE INDEX ix ON users(email) WHERE email IS NOT NULL;');
  const fix = index.violations.find(v => v.ruleId === 'LG-002').safeFix;
  assert.match(fix, /CREATE UNIQUE INDEX CONCURRENTLY/);
  assert.match(fix, /WHERE email IS NOT NULL/);
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

for (const sql of [
  "SET lock_timeout = 0; ALTER TABLE users ADD COLUMN x int;",
  "ALTER TABLE users ADD COLUMN x int; SET lock_timeout = '3s';",
  "SET lock_timeout = '3s'; RESET lock_timeout; ALTER TABLE users ADD COLUMN x int;",
  "SET LOCAL lock_timeout = '3s'; ALTER TABLE users ADD COLUMN x int;",
  "BEGIN; SET LOCAL lock_timeout = '3s'; COMMIT; ALTER TABLE users ADD COLUMN x int;",
  "BEGIN; SET lock_timeout = '3s'; ROLLBACK; ALTER TABLE users ADD COLUMN x int;"
]) {
  test(`QA timeout protection: ${sql}`, () => {
    assert.ok(engine.analyze(sql).violations.some(v => v.ruleId === 'LG-008'));
  });
}
test('QA effective session and local timeouts remain accepted', () => {
  for (const sql of [
    "SET SESSION lock_timeout = '3s'; ALTER TABLE users ADD COLUMN x int;",
    "BEGIN; SET LOCAL lock_timeout = '3s'; ALTER TABLE users ADD COLUMN x int; COMMIT;"
  ]) assert.ok(!engine.analyze(sql).violations.some(v => v.ruleId === 'LG-008'));
});
test('QA rule errors and invalid severity cannot produce PASSED', () => {
  assert.throws(() => engine.analyze('SELECT 1;', { failOnSeverity: 'TYPO' }), /Invalid severity/);
  const broken = new RuleEngine([{ id: 'BROKEN', check() { throw new Error('failure'); } }]);
  assert.throws(() => broken.analyze('SELECT 1;'), /Analysis incomplete/);
});
test('QA revoked default key stays revoked and capped history has unique IDs', () => {
  const db = new PersistentDatabase({ memoryOnly: true });
  const key = db.createApiKey('QA');
  assert.ok(db.verifyApiKey(key.key));
  db.revokeApiKey(key.id);
  assert.equal(db.verifyApiKey(key.key), false);
  for (let i = 0; i < 130; i++) db.addRun({ repo: 'qa/test' });
  assert.equal(db.getRuns().length, 100);
  assert.equal(new Set(db.getRuns().map(r => r.id)).size, 100);
});
test('QA invoice escapes untrusted HTML', () => {
  const html = Billing.generateB2BInvoice({ companyName: '<script>alert(1)</script>', inn: '<img src=x onerror=alert(1)>' }).html;
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Минсафин Марсель Ренатович'));
  assert.ok(html.includes('631112758865'));
  assert.ok(!html.includes('40802810500001234567'));
  assert.ok(!html.includes('7710140679'));
  assert.ok(!html.includes('УСН'));
});
test('QA psql connection string is an argument, not shell code', t => {
  const cp = require('node:child_process');
  const dbUrl = 'postgres://user:$(echo injected)@localhost/db';
  t.mock.method(cp, 'execFileSync', (file, args, options) => {
    assert.equal(file, 'psql');
    assert.equal(args[args.indexOf('-d') + 1], dbUrl);
    assert.ok(options.timeout > 0);
    return 'users,123,4\n';
  });
  assert.equal(ContextAnalyzer.fetchSchemaStats({ useLiveDb: true, databaseUrl: dbUrl }).users.rowCount, 123);
});
test('QA invalid git revision fails rather than passing an empty diff', () => {
  assert.throws(() => CLI.getGitChangedFiles('qa-nonexistent-revision'), /Cannot determine/);
  assert.throws(() => CLI.getGitChangedFiles('--output=qa'), /Invalid git/);
});

function request(port, route, body, headers = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
test('QA HTTP malformed inputs, access controls and byte limit', async () => {
  const server = require('../src/server/server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const admin = { authorization: 'Bearer qa-admin-token' };
  try {
    for (const body of ['{', 'null', '[]', '42']) {
      assert.equal((await request(port, '/api/v1/analyze', body)).status, 400);
    }
    assert.equal((await request(port, '/api/v1/keys/%ZZ', undefined, {}, 'DELETE')).status, 400);
    assert.equal((await request(port, '/api/v1/not-found', undefined, {}, 'GET')).status, 404);
    assert.equal((await request(port, '/api/v1/keys', undefined, {}, 'GET')).status, 401);
    assert.equal((await request(port, '/api/v1/keys', undefined, admin, 'GET')).status, 200);
    assert.equal((await request(port, '/api/v1/organization', '{"plan":"business"}', admin)).status, 400);
    assert.equal((await request(port, '/api/v1/analyze', '{"sql":"SELECT 1;","recordRun":true}')).status, 401);
    assert.equal((await request(port, '/api/v1/github/webhook', '{}', { ...admin, 'x-github-event': 'pull_request' })).status, 503);
    for (const route of ['/api/v1/split', '/api/v1/simulate']) {
      assert.equal((await request(port, route, '{"sql":42}')).status, 400);
    }
    assert.equal((await request(port, '/api/v1/simulate', '{"sql":"SELECT 1","simulatedRows":-1}')).status, 400);
    const huge = JSON.stringify({ sql: 'я'.repeat(600000) });
    assert.equal((await request(port, '/api/v1/analyze', huge)).status, 413);
    assert.equal((await request(port, '/api/v1/rules', undefined, {}, 'GET')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
