const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RuleEngine, LockLevel, Severity } = require('../src/core');

const engine = new RuleEngine();

test('RuleEngine - lists all 8 fatal anti-pattern rules', () => {
  const rules = engine.getRules();
  assert.equal(rules.length, 8);
  const ids = rules.map(r => r.id);
  assert.deepEqual(ids, ['LG-001', 'LG-002', 'LG-003', 'LG-004', 'LG-005', 'LG-006', 'LG-007', 'LG-008']);
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

test('RuleEngine - Fixture 10: 100% Safe Migration PASSED with 0 violations', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../fixtures/10_safe_migration.sql'), 'utf8');
  const res = engine.analyze(sql);
  assert.equal(res.passed, true);
  assert.equal(res.violationsCount, 0);
  assert.equal(res.status, 'PASSED');
});
