require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RuleEngine, SchemaCatalog, CascadeGraph, PgParser } = require('../src/core');
const engine = new RuleEngine();
const schemaSql = 'CREATE TABLE accounts(id int PRIMARY KEY); CREATE TABLE orders(id int, account_id int); CREATE INDEX ix_account ON orders(account_id);';
const foreignKey = 'ALTER TABLE orders ADD CONSTRAINT fk_a FOREIGN KEY(account_id) REFERENCES accounts(id) NOT VALID;';
const analyze = (sql = foreignKey, options = {}) => engine.analyze("SET lock_timeout='3s';" + sql, options);
const foreignKeyFindings = result => result.violations.filter(item => item.ruleId === 'LG-011');

test('The pilot snapshot removes the duplicate cascade warning from both before and after reports', () => {
  const fixture = name => fs.readFileSync(path.join(__dirname, '../fixtures/team-pilot', name), 'utf8');
  const schema = SchemaCatalog.fromSQL(fixture('schema.sql'));
  const withoutSchema = engine.analyze(fixture('before.sql'));
  assert.equal(foreignKeyFindings(withoutSchema).length, 1);
  assert.equal(withoutSchema.cascadeWarnings.length, 1);
  for (const name of ['before.sql', 'after.sql']) {
    const result = engine.analyze(fixture(name), { schema });
    assert.equal(foreignKeyFindings(result).length, 0, name);
    assert.deepEqual(result.cascadeWarnings, [], name);
  }
});

test('An earlier composite index with the FK columns as its prefix covers the cascade graph', () => {
  const result = analyze('CREATE INDEX CONCURRENTLY ix_account ON orders(account_id,id);' + foreignKey);
  assert.equal(foreignKeyFindings(result).length, 0);
  assert.deepEqual(result.cascadeWarnings, []);
});

test('Invalid, partial, expression, custom, non-btree and wrong-prefix indexes cannot hide either warning', () => {
  for (const patch of [{ valid: false }, { partial: true }, { expression: true }, { customSemantics: true }, { method: 'hash' }, { columns: ['id','account_id'] }]) {
    const schema = SchemaCatalog.fromSQL(schemaSql).toJSON();
    Object.assign(schema.tables[1].indexes[0], patch);
    const result = analyze(foreignKey, { schema });
    assert.equal(foreignKeyFindings(result).length, 1, JSON.stringify(patch));
    assert.equal(result.cascadeWarnings.length, 1, JSON.stringify(patch));
  }
});

test('Dropped indexes, changed tables and unresolved search_path invalidate snapshot evidence in both reports', () => {
  const schema = SchemaCatalog.fromSQL(schemaSql);
  for (const prefix of ['DROP INDEX ix_account;', 'ALTER TABLE orders DROP COLUMN id;', 'SET search_path=archive;']) {
    const result = analyze(prefix + foreignKey, { schema });
    assert.equal(foreignKeyFindings(result).length, 1, prefix);
    assert.equal(result.cascadeWarnings.length, 1, prefix);
  }
});

test('Quoted identifiers resolve in the matching schema and never borrow another schema index', () => {
  const schema = SchemaCatalog.fromSQL('CREATE TABLE "odd.schema"."Order.Items"("Account ID" int); CREATE INDEX "Index.name" ON "odd.schema"."Order.Items"("Account ID");');
  const matching = analyze('ALTER TABLE "odd.schema"."Order.Items" ADD CONSTRAINT fk FOREIGN KEY("Account ID") REFERENCES accounts(id) NOT VALID;', { schema });
  assert.equal(foreignKeyFindings(matching).length, 0);
  assert.deepEqual(matching.cascadeWarnings, []);
  const otherSchema = SchemaCatalog.fromSQL(schemaSql.replaceAll('orders', 'archive.orders'));
  const mismatch = analyze(foreignKey, { schema: otherSchema });
  assert.equal(foreignKeyFindings(mismatch).length, 1);
  assert.equal(mismatch.cascadeWarnings.length, 1);
});

test('An index built later cannot erase the creation-time finding but covers the final dependency graph', () => {
  const result = analyze(foreignKey + 'CREATE INDEX CONCURRENTLY ix_account ON orders(account_id);');
  assert.equal(foreignKeyFindings(result).length, 1);
  assert.deepEqual(result.cascadeWarnings, []);
});

test('Dropping the supporting index after adding the FK restores the final cascade warning', () => {
  const result = analyze(foreignKey + 'DROP INDEX ix_account;', { schema: SchemaCatalog.fromSQL(schemaSql) });
  assert.equal(foreignKeyFindings(result).length, 0);
  assert.equal(result.cascadeWarnings.length, 1);
});

test('Ignoring LG-011 does not count as proof of a supporting index', () => {
  const missing = analyze(foreignKey, { ignoreRules: ['LG-011'] });
  assert.equal(foreignKeyFindings(missing).length, 0);
  assert.equal(missing.cascadeWarnings.length, 1);
  const indexed = analyze(foreignKey, { schema: SchemaCatalog.fromSQL(schemaSql), ignoreRules: ['LG-011'] });
  assert.deepEqual(indexed.cascadeWarnings, []);
});

test('The standalone CascadeGraph API also recognizes an index in its SQL input', () => {
  const graph = new CascadeGraph().buildFromAst(PgParser.parse('CREATE INDEX ix_account ON orders(account_id);' + foreignKey));
  assert.deepEqual(graph.findCascadeRisks('accounts'), []);
});

test('The CLI JSON report contains no stale cascade warning for the revised pilot with a snapshot', () => {
  const run = spawnSync(process.execPath, ['bin/lockguard.js', 'check', 'fixtures/team-pilot/after.sql',
    '--schema=fixtures/team-pilot/schema.sql', '--format=json'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.results[0].cascadeWarnings, []);
  assert.equal(report.results[0].schemaContext.verifiedAgainstDatabase, false);
});
