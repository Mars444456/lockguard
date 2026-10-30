require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PgParser, RuleEngine } = require('../src/core');

const engine = new RuleEngine();

test('PgParser Stress - multiline queries with strange tabs, newlines, and mixed casing', () => {
  const sql = `
    AlTeR
    \t   TaBlE
    \t\t   "users"
    \t   aDd   CoLuMn
    \t\t   status   vArChAr(50)   DeFaUlT   'active';
    
    CrEaTe   InDeX   cOnCuRrEnTlY
    \t   idx_users_status   On   "users"   (status);
  `;

  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 2);

  // Statement 1: ALTER TABLE
  assert.equal(ast[0].type, 'ALTER_TABLE');
  assert.equal(ast[0].table, 'users');
  assert.equal(ast[0].subcommands.length, 1);
  assert.equal(ast[0].subcommands[0].subtype, 'ADD_COLUMN');
  assert.equal(ast[0].subcommands[0].column, 'status');
  assert.equal(ast[0].subcommands[0].hasDefault, true);

  // Statement 2: CREATE INDEX CONCURRENTLY
  assert.equal(ast[1].type, 'CREATE_INDEX');
  assert.equal(ast[1].isConcurrent, true);
  assert.equal(ast[1].table, 'users');
  assert.equal(ast[1].indexName, 'idx_users_status');
});

test('PgParser Stress - comment traps: commented-out dangerous SQL returns 0 violations', () => {
  const sql = `
    -- ALTER TABLE users DROP COLUMN id;
    /* CREATE INDEX idx ON t(c); */
    SET lock_timeout = '3s';
    ALTER TABLE users ADD COLUMN bio text;
  `;

  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 2);
  assert.equal(ast[0].type, 'SET_VARIABLE');
  assert.equal(ast[1].type, 'ALTER_TABLE');
  assert.equal(ast[1].table, 'users');
  assert.equal(ast[1].subcommands[0].column, 'bio');

  const analysis = engine.analyze(sql);
  assert.equal(analysis.violationsCount, 0, 'Commented-out dangerous DDL must not trigger any violations');
  assert.equal(analysis.passed, true);
});

test('PgParser Stress - comment traps with internal semicolons do not break statement splitting', () => {
  const sql = `
    -- Line comment with ; semicolon
    SET lock_timeout = '3s';
    /* Block comment with ; semicolon and nested words DROP TABLE; */
    ALTER TABLE users ADD COLUMN nickname text;
  `;

  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 2);
  assert.equal(ast[0].type, 'SET_VARIABLE');
  assert.equal(ast[1].type, 'ALTER_TABLE');
});

test('PgParser Stress - dangerous keywords inside string literals return 0 violations', () => {
  const sql = `
    SET lock_timeout = '3s';
    INSERT INTO audit_log VALUES ('ALTER TABLE users DROP COLUMN id;');
  `;

  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 2);
  assert.equal(ast[0].type, 'SET_VARIABLE');
  assert.equal(ast[1].type, 'STATEMENT');

  const analysis = engine.analyze(sql);
  assert.equal(analysis.violationsCount, 0, 'Dangerous DDL inside string literal must not trigger violations');
  assert.equal(analysis.passed, true);
});

test('PgParser Stress - Dollar-Quoting $$ and $body$ parse blocks and functions as single unit', () => {
  const sql = `
    SET lock_timeout = '3s';
    
    DO $$
    DECLARE
      v_count integer;
    BEGIN
      SELECT count(*) INTO v_count FROM users;
      IF v_count > 1000 THEN
        PERFORM pg_sleep(1);
      END IF;
    END;
    $$;

    CREATE OR REPLACE FUNCTION update_timestamp_audit()
    RETURNS TRIGGER AS $audit_func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $audit_func$ LANGUAGE plpgsql;

    ALTER TABLE users ADD COLUMN updated_at TIMESTAMP;
  `;

  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 4);
  assert.equal(ast[0].type, 'SET_VARIABLE');
  assert.equal(ast[1].type, 'DO_BLOCK');
  assert.equal(ast[2].type, 'CREATE_ROUTINE');
  assert.equal(ast[3].type, 'ALTER_TABLE');
  assert.equal(ast[3].table, 'users');
});

test('PgParser Stress - comma-separated compound ALTER TABLE triggers LG-004 on second action', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE users ADD COLUMN a int, ALTER COLUMN b TYPE varchar(50);
  `;

  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 2);
  assert.equal(ast[1].type, 'ALTER_TABLE');
  assert.equal(ast[1].table, 'users');
  assert.equal(ast[1].subcommands.length, 2);
  assert.equal(ast[1].subcommands[0].subtype, 'ADD_COLUMN');
  assert.equal(ast[1].subcommands[0].column, 'a');
  assert.equal(ast[1].subcommands[1].subtype, 'ALTER_COLUMN_TYPE');
  assert.equal(ast[1].subcommands[1].column, 'b');

  const analysis = engine.analyze(sql);
  const v4 = analysis.violations.find(v => v.ruleId === 'LG-004');
  assert.ok(v4, 'LG-004 must be triggered on the second comma-separated action');
  assert.equal(v4.column, 'b');
  assert.equal(v4.table, 'users');
});

test('PgParser Stress - schemas and quoted table names ("public"."Orders", app.users)', () => {
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE "public"."Orders" ADD COLUMN order_notes text;
    CREATE INDEX idx_app_users ON app.users (created_at);
  `;

  const ast = PgParser.parse(sql);
  assert.equal(ast.length, 3);

  // 1: ALTER TABLE "public"."Orders"
  assert.equal(ast[1].type, 'ALTER_TABLE');
  assert.equal(ast[1].table, 'public."Orders"');
  assert.equal(ast[1].subcommands[0].column, 'order_notes');

  // 2: CREATE INDEX ON app.users
  assert.equal(ast[2].type, 'CREATE_INDEX');
  assert.equal(ast[2].table, 'app.users');
  assert.equal(ast[2].indexName, 'idx_app_users');
});
