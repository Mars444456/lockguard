const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RuleEngine, LockLevel, Severity, PgParser } = require('../src/core');

const engine = new RuleEngine();

test('RuleEngine - lists all 12 fatal anti-pattern rules', () => {
  const rules = engine.getRules();
  assert.equal(rules.length, 12);
  const ids = rules.map(r => r.id);
  assert.deepEqual(ids, [
    'LG-001', 'LG-002', 'LG-003', 'LG-004', 'LG-005',
    'LG-006', 'LG-007', 'LG-008', 'LG-009', 'LG-010',
    'LG-011', 'LG-012'
  ]);
});

test('RuleEngine - Fixture 01: Dangerous ADD COLUMN with volatile DEFAULT (LG-001)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/01_dangerous_add_column.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  assert.equal(res.highestLockLevel, LockLevel.ACCESS_EXCLUSIVE);
  const v = res.violations.find(v => v.ruleId === 'LG-001');
  assert.ok(v);
  assert.ok(v.safeFix.includes('ALTER TABLE orders ADD COLUMN created_at'));
});

test('RuleEngine - Fixture 02: Non-concurrent CREATE INDEX (LG-002)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/02_dangerous_create_index.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  assert.equal(res.highestLockLevel, LockLevel.SHARE);
  const v = res.violations.find(v => v.ruleId === 'LG-002');
  assert.ok(v);
  assert.ok(v.safeFix.includes('CREATE INDEX CONCURRENTLY'));
});

test('RuleEngine - Fixture 03: Foreign Key without NOT VALID (LG-003)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/03_dangerous_fk.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-003');
  assert.ok(v);
  assert.ok(v.safeFix.includes('NOT VALID'));
  assert.ok(v.safeFix.includes('VALIDATE CONSTRAINT'));
});

test('RuleEngine - Fixture 04: ALTER COLUMN TYPE table rewrite (LG-004)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/04_dangerous_alter_type.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-004');
  assert.ok(v);
  assert.ok(v.safeFix.includes('amount_new'));
});

test('RuleEngine - Fixture 05: Direct UNIQUE constraint (LG-005)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/05_dangerous_unique.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-005');
  assert.ok(v);
  assert.ok(v.safeFix.includes('CREATE UNIQUE INDEX CONCURRENTLY'));
  assert.ok(v.safeFix.includes('USING INDEX'));
});

test('RuleEngine - Fixture 06: Immediate DROP COLUMN (LG-006)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/06_dangerous_drop_column.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-006');
  assert.ok(v);
});

test('RuleEngine - Fixture 07: VACUUM inside migration (LG-007)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/07_dangerous_vacuum.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-007');
  assert.ok(v);
});

test('RuleEngine - Fixture 08: Missing SET lock_timeout (LG-008)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/08_missing_lock_timeout.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-008');
  assert.ok(v);
  assert.ok(v.safeFix.includes("SET lock_timeout = '3s';"));
});

test('RuleEngine - Rule 09: Unsafe ALTER COLUMN SET NOT NULL (LG-009)', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE users ALTER COLUMN email SET NOT NULL;
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-009');
  assert.ok(v);
  assert.equal(v.table, 'users');
  assert.equal(v.column, 'email');
  assert.ok(v.safeFix.includes('CHECK (email IS NOT NULL) NOT VALID'));
  assert.ok(v.safeFix.includes('VALIDATE CONSTRAINT users_email_not_null'));
});

test('RuleEngine - Rule 10: CONCURRENTLY inside transaction block (LG-010)', () => {
  const sql = `
    BEGIN;
    SET lock_timeout = '3s';
    CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
    COMMIT;
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-010');
  assert.ok(v);
  assert.ok(v.message.includes('ERROR: 25001'));
  assert.ok(v.safeFix.includes('Remove the transaction block'));
});

test('RuleEngine - Smart Context: CREATE TABLE in same file prevents false positives', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE TABLE new_products (
      id serial primary key,
      title text,
      category_id int
    );
    -- The following would normally trigger LG-002, LG-003, LG-004, LG-009 on existing tables
    CREATE INDEX idx_products_cat ON new_products(category_id);
    ALTER TABLE new_products ADD CONSTRAINT fk_cat FOREIGN KEY (category_id) REFERENCES categories(id);
    ALTER TABLE new_products ALTER COLUMN title TYPE varchar(500);
    ALTER TABLE new_products ALTER COLUMN title SET NOT NULL;
  `;
  const res = engine.analyze(sql);
  // None of LG-002, LG-003, LG-004, LG-009 should trigger on new_products!
  const dangerousRules = ['LG-002', 'LG-003', 'LG-004', 'LG-009'];
  const found = res.violations.filter(v => dangerousRules.includes(v.ruleId));
  assert.equal(found.length, 0);
});

test('RuleEngine - Inline Ignore: -- lockguard-ignore suppresses specific rule', () => {
  const sql = `
    SET lock_timeout = '3s';
    -- lockguard-ignore: LG-004
    ALTER TABLE users ALTER COLUMN age TYPE bigint;
  `;
  const res = engine.analyze(sql);
  const v4 = res.violations.find(v => v.ruleId === 'LG-004');
  assert.equal(v4, undefined);
});

test('RuleEngine - Inline Ignore: -- lockguard-ignore-all suppresses all rules for statement', () => {
  const sql = `
    SET lock_timeout = '3s';
    -- lockguard-ignore-all
    CREATE INDEX idx_orders_unindexed ON orders(status);
  `;
  const res = engine.analyze(sql);
  const v2 = res.violations.find(v => v.ruleId === 'LG-002');
  assert.equal(v2, undefined);
});

test('RuleEngine - Dollar-Quoting: does not split statements on internal semicolons', () => {
  const sql = `
    SET lock_timeout = '3s';
    DO $$
    BEGIN
      PERFORM 1;
      PERFORM 2;
    END;
    $$;
    ALTER TABLE users ADD COLUMN phone text;
  `;
  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 3);
  assert.equal(ast[0].type, 'SET_VARIABLE');
  assert.equal(ast[1].type, 'DO_BLOCK');
  assert.equal(ast[2].type, 'ALTER_TABLE');
});

test('RuleEngine - Fixture 10: 100% Safe Migration PASSED with 0 violations', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/10_safe_migration.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, true);
  assert.equal(res.violationsCount, 0);
  assert.equal(res.status, 'PASSED');
});
