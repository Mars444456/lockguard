require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { RuleEngine, AutoSplitter, PgParser } = require('../src/core');
const engine = new RuleEngine();
async function execute(db, sql) {
  for (const stmt of PgParser.parse(sql)) await db.exec(stmt.raw);
}
test('PostgreSQL executes safe fixture and preserves FK validation and unique index', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE accounts(id int PRIMARY KEY, iban text); CREATE TABLE transactions(id int, account_id int, created_at timestamp);');
    await execute(db, fs.readFileSync(path.join(__dirname, '../fixtures/10_safe_migration.sql'), 'utf8'));
    const fk = await db.query("SELECT convalidated FROM pg_constraint WHERE conname='fk_tx_account'");
    assert.equal(fk.rows[0].convalidated, true);
    await db.exec("INSERT INTO accounts VALUES(1, 'iban-1', NULL);");
    await assert.rejects(db.exec("INSERT INTO accounts VALUES(2, 'iban-1', NULL);"), /duplicate key/);
  } finally { await db.close(); }
});
test('PostgreSQL: UUID split preserves rows, UUID type, default and NOT NULL', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE users(id int PRIMARY KEY); INSERT INTO users VALUES(1),(2);');
    const plan = AutoSplitter.generatePlan(engine.analyze('SET lock_timeout=3000; ALTER TABLE users ADD COLUMN token UUID DEFAULT gen_random_uuid() NOT NULL;'));
    await execute(db, plan.phases.find(p => p.phaseNumber === 1).sql);
    // Explicit bounded backfill between schema releases.
    await db.exec('UPDATE users SET token=gen_random_uuid() WHERE id IN (SELECT id FROM users WHERE token IS NULL LIMIT 100);');
    for (const p of plan.phases.filter(p => p.phaseNumber >= 3)) await execute(db, p.sql);
    const schema = await db.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_name='users' AND column_name='token'");
    assert.equal(schema.rows[0].data_type, 'uuid');
    assert.equal(schema.rows[0].is_nullable, 'NO');
    assert.match(schema.rows[0].column_default, /gen_random_uuid/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM users WHERE token IS NOT NULL')).rows[0].n, 2);
  } finally { await db.close(); }
});
test('PostgreSQL: FK fix retains referenced column and delete action', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE parent(code int PRIMARY KEY); CREATE TABLE child(code int); INSERT INTO parent VALUES(7); INSERT INTO child VALUES(7);');
    const result = engine.analyze('SET lock_timeout=3000; ALTER TABLE child ADD CONSTRAINT fk FOREIGN KEY(code) REFERENCES parent(code) ON DELETE CASCADE;');
    await execute(db, result.violations.find(v => v.ruleId === 'LG-003').safeFix);
    await db.exec('DELETE FROM parent WHERE code=7;');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM child')).rows[0].n, 0);
  } finally { await db.close(); }
});
test('Native parser accepts PostgreSQL escapes and rejects invalid syntax before rules', () => {
  assert.throws(() => engine.analyze('ALTER TABLE users ADD COLUMN x int RENAME TO invalid;'), SyntaxError);
  const result = engine.analyze('SET lock_timeout=3000; CREATE INDEX ix ON "События с пробелом" ("ключ");');
  assert.equal(result.violations.find(v => v.ruleId === 'LG-002').table, '"События с пробелом"');
  const safe = engine.analyze("SET lock_timeout=3000; ALTER TABLE users ADD COLUMN note text DEFAULT 'random()';");
  assert.ok(!safe.violations.some(v => v.ruleId === 'LG-001'));
});
test('Unknown function calls require review and index expressions/partials cannot prove FK coverage', () => {
  assert.equal(engine.analyze('SELECT migrate_schema();').analysisComplete, false);
  for (const index of [
    'CREATE INDEX CONCURRENTLY ix ON child(other,code);',
    'CREATE INDEX CONCURRENTLY ix ON child(code) WHERE code>0;',
    'CREATE INDEX CONCURRENTLY ix ON child(lower(code::text));'
  ]) {
    const result = engine.analyze(`SET lock_timeout=3000; ${index} ALTER TABLE child ADD CONSTRAINT fk FOREIGN KEY(code) REFERENCES parent(code) NOT VALID;`);
    assert.ok(result.violations.some(v => v.ruleId === 'LG-011'));
  }
});
test('Default expressions survive quoted identifiers, commas and casts', () => {
  const result = engine.analyze('SET lock_timeout=3000; ALTER TABLE "My Users" ADD COLUMN "Token Id" UUID DEFAULT gen_random_uuid() NOT NULL;');
  const violation = result.violations.find(v => v.ruleId === 'LG-001');
  assert.equal(violation.column, '"Token Id"');
  assert.equal(violation.defaultValue, 'gen_random_uuid()');
});
test('NOT NULL optimization requires an earlier validated check that has not been dropped', () => {
  for (const sql of [
    'ALTER TABLE users ALTER COLUMN x SET NOT NULL; ALTER TABLE users ADD CONSTRAINT ck CHECK(x IS NOT NULL) NOT VALID; ALTER TABLE users VALIDATE CONSTRAINT ck;',
    'ALTER TABLE users ADD CONSTRAINT ck CHECK(x IS NOT NULL) NOT VALID; ALTER TABLE users VALIDATE CONSTRAINT ck; ALTER TABLE users DROP CONSTRAINT ck; ALTER TABLE users ALTER COLUMN x SET NOT NULL;'
  ]) assert.ok(engine.analyze('SET lock_timeout=3000;' + sql).violations.some(v => v.ruleId === 'LG-009'));
});
test('Context does not merge distinct case-sensitive PostgreSQL identifiers', () => {
  const result = engine.analyze('SET lock_timeout=3000; CREATE TABLE "Users"(id int); CREATE INDEX ix ON "USERS"(id);');
  assert.ok(result.violations.some(v => v.ruleId === 'LG-002'));
});
