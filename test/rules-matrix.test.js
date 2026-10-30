const test = require('node:test');
const assert = require('node:assert/strict');
const { RuleEngine, LockLevel, Severity } = require('../src/core');

const engine = new RuleEngine();

// ==============================================================================
// LG-001: ADD COLUMN with volatile DEFAULT
// ==============================================================================
test('Matrix LG-001 - Positive: ADD COLUMN with volatile DEFAULT', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE accounts ADD COLUMN token UUID DEFAULT gen_random_uuid();
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-001');
  assert.ok(v, 'LG-001 violation must be reported');
  assert.equal(v.ruleId, 'LG-001');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.CRITICAL);
  assert.equal(v.line, 3);
  assert.ok(v.safeFix && typeof v.safeFix === 'string' && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes('ALTER TABLE accounts ADD COLUMN token'));
});

test('Matrix LG-001 - Negative: constant defaults and now() in PG 11+ are safe', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE accounts ADD COLUMN status VARCHAR(20) DEFAULT 'active';
    ALTER TABLE accounts ADD COLUMN counter INT DEFAULT 0;
    ALTER TABLE accounts ADD COLUMN is_active BOOLEAN DEFAULT false;
    ALTER TABLE accounts ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-001');
  assert.equal(v.length, 0, 'Constant defaults and now() must NOT trigger LG-001 in PG 11+');
});

// ==============================================================================
// LG-002: CREATE INDEX without CONCURRENTLY
// ==============================================================================
test('Matrix LG-002 - Positive: Non-concurrent CREATE INDEX', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE INDEX idx_users_email ON users (email);
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-002');
  assert.ok(v, 'LG-002 violation must be reported');
  assert.equal(v.ruleId, 'LG-002');
  assert.equal(v.lockLevel, LockLevel.SHARE);
  assert.equal(v.severity, Severity.CRITICAL);
  assert.equal(v.line, 3);
  assert.ok(v.safeFix && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes('CREATE INDEX CONCURRENTLY'));
});

test('Matrix LG-002 - Negative: CREATE INDEX on table created in same file is safe', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE TABLE new_orders (id serial primary key, order_num text);
    CREATE INDEX idx_new_orders_num ON new_orders (order_num);
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-002');
  assert.equal(v.length, 0, 'Non-concurrent index on newly created table must NOT trigger LG-002');
});

// ==============================================================================
// LG-003: Foreign Key without NOT VALID
// ==============================================================================
test('Matrix LG-003 - Positive: Foreign Key without NOT VALID', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-003');
  assert.ok(v, 'LG-003 violation must be reported');
  assert.equal(v.ruleId, 'LG-003');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.CRITICAL);
  assert.equal(v.line, 3);
  assert.ok(v.safeFix && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes('NOT VALID'));
  assert.ok(v.safeFix.includes('VALIDATE CONSTRAINT'));
});

test('Matrix LG-003 - Negative: Foreign Key on table created in same file or with NOT VALID is safe', () => {
  const sqlNewTable = `
    SET lock_timeout = '3s';
    CREATE TABLE order_items (id serial, order_id int);
    ALTER TABLE order_items ADD CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(id);
  `;
  const resNew = engine.analyze(sqlNewTable);
  const vNew = resNew.violations.filter(v => v.ruleId === 'LG-003');
  assert.equal(vNew.length, 0, 'Foreign key on table created in same file must NOT trigger LG-003');

  const sqlNotValid = `
    SET lock_timeout = '3s';
    ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
  `;
  const resNotValid = engine.analyze(sqlNotValid);
  const vNotValid = resNotValid.violations.filter(v => v.ruleId === 'LG-003');
  assert.equal(vNotValid.length, 0, 'Foreign key with NOT VALID must NOT trigger LG-003');
});

// ==============================================================================
// LG-004: ALTER COLUMN TYPE causing full table rewrite
// ==============================================================================
test('Matrix LG-004 - Positive: ALTER COLUMN TYPE on existing table', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE users ALTER COLUMN age TYPE bigint;
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-004');
  assert.ok(v, 'LG-004 violation must be reported');
  assert.equal(v.ruleId, 'LG-004');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.CRITICAL);
  assert.equal(v.line, 3);
  assert.ok(v.safeFix && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes('age_new'));
});

test('Matrix LG-004 - Negative: ALTER COLUMN TYPE on table created in same file is safe', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE TABLE temp_logs (id serial, payload text);
    ALTER TABLE temp_logs ALTER COLUMN payload TYPE varchar(2000);
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-004');
  assert.equal(v.length, 0, 'ALTER COLUMN TYPE on newly created table must NOT trigger LG-004');
});

// ==============================================================================
// LG-005: Adding UNIQUE constraint directly without concurrent index
// ==============================================================================
test('Matrix LG-005 - Positive: Direct UNIQUE constraint', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE accounts ADD CONSTRAINT uq_account_email UNIQUE (email);
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-005');
  assert.ok(v, 'LG-005 violation must be reported');
  assert.equal(v.ruleId, 'LG-005');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.HIGH);
  assert.equal(v.line, 3);
  assert.ok(v.safeFix && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes('CREATE UNIQUE INDEX CONCURRENTLY'));
  assert.ok(v.safeFix.includes('USING INDEX'));
});

test('Matrix LG-005 - Negative: UNIQUE constraint via USING INDEX is safe', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE UNIQUE INDEX CONCURRENTLY uq_account_email_idx ON accounts (email);
    ALTER TABLE accounts ADD CONSTRAINT uq_account_email UNIQUE USING INDEX uq_account_email_idx;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-005');
  assert.equal(v.length, 0, 'Attaching UNIQUE constraint with USING INDEX must NOT trigger LG-005');
});

test('Matrix LG-005 - Negative: UNIQUE constraint on table created in same file is safe', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE TABLE new_accounts (id serial, email text);
    ALTER TABLE new_accounts ADD CONSTRAINT uq_email UNIQUE (email);
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-005');
  assert.equal(v.length, 0, 'UNIQUE constraint on table created in same file must NOT trigger LG-005');
});

// ==============================================================================
// LG-006: Immediate DROP COLUMN or DROP TABLE
// ==============================================================================
test('Matrix LG-006 - Positive: Immediate DROP COLUMN or DROP TABLE', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE users DROP COLUMN phone_number;
    DROP TABLE legacy_users;
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const drops = res.violations.filter(v => v.ruleId === 'LG-006');
  assert.equal(drops.length, 2, 'Both DROP COLUMN and DROP TABLE must trigger LG-006');
  assert.equal(drops[0].lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(drops[0].severity, Severity.HIGH);
  assert.equal(drops[0].line, 3);
  assert.ok(drops[0].safeFix && drops[0].safeFix.length > 0);
  assert.equal(drops[1].lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(drops[1].severity, Severity.HIGH);
  assert.equal(drops[1].line, 4);
});

test('Matrix LG-006 - Negative: Safe schema addition without DROP does not trigger LG-006', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE users ADD COLUMN phone_number text;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-006');
  assert.equal(v.length, 0, 'ADD COLUMN without DROP must NOT trigger LG-006');
});

// ==============================================================================
// LG-007: VACUUM or autovacuum storage parameter inside migration
// ==============================================================================
test('Matrix LG-007 - Positive: VACUUM statement inside migration', () => {
  const sql = `
    VACUUM FULL accounts;
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-007');
  assert.ok(v, 'LG-007 violation must be reported');
  assert.equal(v.ruleId, 'LG-007');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.CRITICAL);
  assert.equal(v.line, 2);
  assert.ok(v.safeFix && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes('Run maintenance operations outside'));
});

test('Matrix LG-007 - Negative: Standard DDL without VACUUM does not trigger LG-007', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE accounts ADD COLUMN is_active boolean DEFAULT false;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-007');
  assert.equal(v.length, 0, 'DDL without VACUUM must NOT trigger LG-007');
});

// ==============================================================================
// LG-008: Missing SET lock_timeout
// ==============================================================================
test('Matrix LG-008 - Positive: DDL migration missing SET lock_timeout', () => {
  const sql = `
    ALTER TABLE accounts ADD COLUMN balance_cents bigint;
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-008');
  assert.ok(v, 'LG-008 violation must be reported');
  assert.equal(v.ruleId, 'LG-008');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.HIGH);
  assert.equal(v.line, 1);
  assert.ok(v.safeFix && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes("SET lock_timeout = '3s';"));
});

test('Matrix LG-008 - Negative: SET lock_timeout or SET LOCAL lock_timeout satisfies LG-008', () => {
  const sqlGlobal = `
    SET lock_timeout = '3s';
    ALTER TABLE accounts ADD COLUMN balance_cents bigint;
  `;
  const resGlobal = engine.analyze(sqlGlobal);
  const vGlobal = resGlobal.violations.filter(v => v.ruleId === 'LG-008');
  assert.equal(vGlobal.length, 0, 'SET lock_timeout must satisfy LG-008');

  const sqlLocal = `
    SET LOCAL lock_timeout = '2s';
    ALTER TABLE accounts ADD COLUMN balance_cents bigint;
  `;
  const resLocal = engine.analyze(sqlLocal);
  const vLocal = resLocal.violations.filter(v => v.ruleId === 'LG-008');
  assert.equal(vLocal.length, 0, 'SET LOCAL lock_timeout must satisfy LG-008');
});

// ==============================================================================
// LG-009: Unsafe ALTER COLUMN SET NOT NULL
// ==============================================================================
test('Matrix LG-009 - Positive: Direct ALTER COLUMN SET NOT NULL on existing table', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE users ALTER COLUMN username SET NOT NULL;
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-009');
  assert.ok(v, 'LG-009 violation must be reported');
  assert.equal(v.ruleId, 'LG-009');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.CRITICAL);
  assert.equal(v.line, 3);
  assert.ok(v.safeFix && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes('CHECK (username IS NOT NULL) NOT VALID'));
  assert.ok(v.safeFix.includes('VALIDATE CONSTRAINT'));
});

test('Matrix LG-009 - Negative: SET NOT NULL on new table or with validated CHECK constraint is safe', () => {
  const sqlValidated = `
    SET lock_timeout = '3s';
    ALTER TABLE users ADD CONSTRAINT chk_users_username_not_null CHECK (username IS NOT NULL) NOT VALID;
    ALTER TABLE users VALIDATE CONSTRAINT chk_users_username_not_null;
    ALTER TABLE users ALTER COLUMN username SET NOT NULL;
    ALTER TABLE users DROP CONSTRAINT chk_users_username_not_null;
  `;
  const resValidated = engine.analyze(sqlValidated);
  const vValidated = resValidated.violations.filter(v => v.ruleId === 'LG-009');
  assert.equal(vValidated.length, 0, 'Validated CHECK constraint must satisfy LG-009');

  const sqlNewTable = `
    SET lock_timeout = '3s';
    CREATE TABLE new_accounts (id serial, code text);
    ALTER TABLE new_accounts ALTER COLUMN code SET NOT NULL;
  `;
  const resNewTable = engine.analyze(sqlNewTable);
  const vNewTable = resNewTable.violations.filter(v => v.ruleId === 'LG-009');
  assert.equal(vNewTable.length, 0, 'SET NOT NULL on newly created table must NOT trigger LG-009');
});

// ==============================================================================
// LG-010: CONCURRENTLY inside transaction block
// ==============================================================================
test('Matrix LG-010 - Positive: CREATE INDEX CONCURRENTLY inside BEGIN...COMMIT block', () => {
  const sql = `
    BEGIN;
    SET lock_timeout = '3s';
    CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
    COMMIT;
  `;
  const res = engine.analyze(sql);
  assert.equal(res.passed, false);
  const v = res.violations.find(v => v.ruleId === 'LG-010');
  assert.ok(v, 'LG-010 violation must be reported');
  assert.equal(v.ruleId, 'LG-010');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.CRITICAL);
  assert.equal(v.line, 4);
  assert.ok(v.safeFix && v.safeFix.length > 0, 'Safe SQL Recipe must be non-empty');
  assert.ok(v.safeFix.includes('Remove the transaction block'));
});

test('Matrix LG-010 - Negative: CREATE INDEX CONCURRENTLY outside transaction block is safe', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
  `;
  const res = engine.analyze(sql);
  const v10 = res.violations.filter(v => v.ruleId === 'LG-010');
  assert.equal(v10.length, 0, 'CONCURRENTLY outside transaction block must NOT trigger LG-010');
  assert.equal(res.passed, true);
});

// ==============================================================================
// Context & Ignore Directives: CREATE TABLE context, -- lockguard-ignore, -- lockguard-ignore-all
// ==============================================================================
test('Matrix Context - CREATE TABLE in same file suppresses LG-002, LG-003, LG-004, LG-005, LG-009', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE TABLE product_catalog (
      id serial primary key,
      category_id int,
      sku text,
      tags text
    );
    -- None of the below should trigger on the newly created table
    CREATE INDEX idx_products_cat ON product_catalog(category_id);
    ALTER TABLE product_catalog ADD CONSTRAINT fk_cat FOREIGN KEY (category_id) REFERENCES categories(id);
    ALTER TABLE product_catalog ALTER COLUMN sku TYPE varchar(100);
    ALTER TABLE product_catalog ADD CONSTRAINT uq_sku UNIQUE (sku);
    ALTER TABLE product_catalog ALTER COLUMN tags SET NOT NULL;
  `;
  const res = engine.analyze(sql);
  const dangerousRules = ['LG-002', 'LG-003', 'LG-004', 'LG-005', 'LG-009'];
  const found = res.violations.filter(v => dangerousRules.includes(v.ruleId));
  assert.equal(found.length, 0, 'Newly created table must not trigger LG-002, LG-003, LG-004, LG-005, LG-009');
});

test('Matrix Ignore Directives - Specific rule suppression with -- lockguard-ignore: LG-004', () => {
  const sql = `
    SET lock_timeout = '3s';
    -- lockguard-ignore: LG-004
    ALTER TABLE users ALTER COLUMN age TYPE bigint;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-004');
  assert.equal(v.length, 0, '-- lockguard-ignore: LG-004 must suppress rule LG-004');
});

test('Matrix Ignore Directives - All rules suppression with -- lockguard-ignore-all', () => {
  const sql = `
    SET lock_timeout = '3s';
    -- lockguard-ignore-all
    ALTER TABLE users ALTER COLUMN age TYPE bigint;
    -- lockguard-ignore-all
    CREATE INDEX idx_users_age ON users (age);
  `;
  const res = engine.analyze(sql);
  assert.equal(res.violationsCount, 0, '-- lockguard-ignore-all must suppress all rules on the target statement');
  assert.equal(res.passed, true);
});

// ==============================================================================
// LG-011: Adding Foreign Key without supporting index
// ==============================================================================
test('Matrix LG-011 - Positive: Foreign Key without supporting index', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) NOT VALID;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.find(v => v.ruleId === 'LG-011');
  assert.ok(v, 'LG-011 violation must be reported when FK child column is unindexed');
  assert.equal(v.ruleId, 'LG-011');
  assert.equal(v.lockLevel, LockLevel.SHARE_ROW_EXCLUSIVE);
  assert.equal(v.severity, Severity.MEDIUM);
  assert.ok(v.safeFix.includes('CREATE INDEX CONCURRENTLY'));
});

test('Matrix LG-011 - Negative: Foreign Key with supporting index is safe', () => {
  const sql = `
    SET lock_timeout = '3s';
    CREATE INDEX CONCURRENTLY idx_orders_customer_id ON orders (customer_id);
    ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) NOT VALID;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-011');
  assert.equal(v.length, 0, 'LG-011 must NOT trigger when supporting index exists on FK columns');
});

// ==============================================================================
// LG-012: TRUNCATE and non-concurrent MATERIALIZED VIEW
// ==============================================================================
test('Matrix LG-012 - Positive: TRUNCATE TABLE acquires ACCESS EXCLUSIVE', () => {
  const sql = `
    SET lock_timeout = '3s';
    TRUNCATE TABLE audit_logs;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.find(v => v.ruleId === 'LG-012');
  assert.ok(v, 'LG-012 must report TRUNCATE TABLE');
  assert.equal(v.ruleId, 'LG-012');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.CRITICAL);
});

test('Matrix LG-012 - Positive: REFRESH MATERIALIZED VIEW without CONCURRENTLY', () => {
  const sql = `
    SET lock_timeout = '3s';
    REFRESH MATERIALIZED VIEW mv_user_summaries;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.find(v => v.ruleId === 'LG-012');
  assert.ok(v, 'LG-012 must report unconcurrent REFRESH MATERIALIZED VIEW');
  assert.equal(v.ruleId, 'LG-012');
  assert.equal(v.lockLevel, LockLevel.ACCESS_EXCLUSIVE);
  assert.equal(v.severity, Severity.CRITICAL);
  assert.ok(v.safeFix.includes('CONCURRENTLY'));
});

test('Matrix LG-012 - Negative: REFRESH MATERIALIZED VIEW CONCURRENTLY is safe', () => {
  const sql = `
    SET lock_timeout = '3s';
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_summaries;
  `;
  const res = engine.analyze(sql);
  const v = res.violations.filter(v => v.ruleId === 'LG-012');
  assert.equal(v.length, 0, 'REFRESH MATERIALIZED VIEW CONCURRENTLY must NOT trigger LG-012');
});
