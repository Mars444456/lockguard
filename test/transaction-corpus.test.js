require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { RuleEngine, AutoSplitter, Severity } = require('../src/core');
const engine = new RuleEngine();
const ddl = 'ALTER TABLE items ADD COLUMN note text;';
const finding = (sql, id, options) => engine.analyze(sql, options).violations.find(v => v.ruleId === id);

// PostgreSQL SET semantics: a second BEGIN does not create a nested transaction;
// SET changes are rolled back with the surrounding transaction.
// https://www.postgresql.org/docs/17/sql-set.html
// https://www.postgresql.org/docs/17/sql-begin.html
test('Nested BEGIN cannot preserve a session timeout after the surrounding ROLLBACK', () => {
  const sql = "BEGIN; SET lock_timeout='3s'; BEGIN; ROLLBACK; " + ddl;
  const result = engine.analyze(sql);
  assert.ok(result.violations.some(v => v.ruleId === 'LG-008'));
  assert.equal(result.passed, false);
});

test('Nested BEGIN must not discard the pre-transaction timeout restored by ROLLBACK', () => {
  const sql = "SET lock_timeout='3s'; BEGIN; SET lock_timeout=0; BEGIN; ROLLBACK; " + ddl;
  assert.equal(finding(sql, 'LG-008'), undefined);
});

test('ABORT rolls back a session timeout just like the ROLLBACK alias', () => {
  const violation = finding("BEGIN; SET lock_timeout='3s'; ABORT WORK; " + ddl, 'LG-008');
  assert.ok(violation);
  assert.equal(violation.inTransaction, false);
});

// AND [NO] CHAIN was added in PostgreSQL 12; the v11 COMMIT synopsis lacks it.
// https://www.postgresql.org/docs/11/sql-commit.html
// https://www.postgresql.org/docs/12/sql-commit.html
test('Transaction chaining cannot be certified for PostgreSQL 10 or 11', () => {
  for (const end of ['COMMIT AND CHAIN', 'ROLLBACK AND CHAIN', 'COMMIT AND NO CHAIN']) {
    const sql = `SET lock_timeout='3s'; BEGIN; ${end}; ${ddl}`;
    for (const pgVersion of [10, 11]) {
      const result = engine.analyze(sql, { pgVersion });
      assert.equal(result.analysisComplete, false, `${end}, PostgreSQL ${pgVersion}`);
      assert.equal(result.passed, false);
      assert.ok(result.violations.some(v => v.ruleId === 'LG-000'));
    }
    assert.equal(engine.analyze(sql, { pgVersion: 12 }).analysisComplete, true);
  }
});

for (const end of ['COMMIT AND CHAIN', 'ROLLBACK AND CHAIN']) {
  test(`VACUUM remains prohibited after ${end}`, () => {
    const violation = finding(`BEGIN; ${end}; VACUUM items; ROLLBACK;`, 'LG-007');
    assert.equal(violation.severity, Severity.CRITICAL);
    assert.match(violation.message, /transaction.*fail/i);
  });

  test(`A local timeout expires when ${end} starts the next transaction`, () => {
    const sql = `BEGIN; SET LOCAL lock_timeout='3s'; ${end}; ${ddl} COMMIT;`;
    const violation = finding(sql, 'LG-008');
    assert.ok(violation);
    assert.equal(violation.inTransaction, true);
  });
}

test('Runner-wrapped VACUUM has the same failure as an explicit transaction', () => {
  const violation = finding('VACUUM items;', 'LG-007', { transactionWrapped: true });
  assert.equal(violation.severity, Severity.CRITICAL);
});

test('Runner-wrapped SET LOCAL protects the DDL in that actual transaction', () => {
  assert.equal(finding("SET LOCAL lock_timeout='3s'; " + ddl, 'LG-008', { transactionWrapped: true }), undefined);
});

for (const end of ['COMMIT AND NO CHAIN', 'ROLLBACK AND NO CHAIN', 'END WORK']) {
  test(`${end} allows a following standalone concurrent operation`, () => {
    const sql = `SET lock_timeout='3s'; BEGIN; SELECT 1; ${end}; CREATE INDEX CONCURRENTLY ix_items ON items(id);`;
    assert.equal(finding(sql, 'LG-010'), undefined);
  });
}

test('Session timeout survives COMMIT AND CHAIN but not ROLLBACK AND CHAIN', () => {
  const protectedSql = "BEGIN; SET lock_timeout='3s'; COMMIT AND CHAIN; " + ddl + ' COMMIT;';
  const unprotectedSql = "BEGIN; SET lock_timeout='3s'; ROLLBACK AND CHAIN; " + ddl + ' COMMIT;';
  assert.equal(finding(protectedSql, 'LG-008'), undefined);
  assert.equal(finding(unprotectedSql, 'LG-008').inTransaction, true);
});

test('Commit restores the session timeout after a local override', () => {
  for (const end of ['COMMIT', 'COMMIT AND CHAIN']) {
    assert.equal(finding(`SET lock_timeout='3s'; BEGIN; SET LOCAL lock_timeout=0; ${end}; ${ddl}`, 'LG-008'), undefined);
  }
});

test('A transactional RESET ALL is undone by rollback, but persists after commit', () => {
  assert.equal(finding("SET lock_timeout='3s'; BEGIN; RESET ALL; ROLLBACK; " + ddl, 'LG-008'), undefined);
  assert.ok(finding("SET lock_timeout='3s'; BEGIN; RESET ALL; COMMIT; " + ddl, 'LG-008'));
});

for (const statement of ['RESET ALL;', 'SET lock_timeout TO DEFAULT;', "SET lock_timeout='0ms';"]) {
  test(`${statement} does not inherit a previous positive timeout`, () => {
    assert.ok(finding("SET lock_timeout='3s'; " + statement + ' ' + ddl, 'LG-008'));
  });
}

test('SAVEPOINT semantics remain explicitly incomplete instead of producing a clean verdict', () => {
  for (const setting of ['SET', 'SET LOCAL']) {
    const result = engine.analyze(`BEGIN; SAVEPOINT before_timeout; ${setting} lock_timeout='3s'; ROLLBACK TO SAVEPOINT before_timeout; ${ddl} COMMIT;`);
    assert.equal(result.analysisComplete, false);
    assert.equal(result.passed, false);
    assert.notEqual(result.status, 'PASSED');
    assert.ok(result.violations.some(v => v.ruleId === 'LG-000'));
    assert.throws(() => AutoSplitter.generatePlan(result), /incomplete/i);
  }
});

test('A released savepoint does not make an unsupported transaction construct fully analyzed', () => {
  const result = engine.analyze(`BEGIN; SAVEPOINT s; SET LOCAL lock_timeout='3s'; RELEASE SAVEPOINT s; ${ddl} COMMIT;`);
  assert.equal(result.analysisComplete, false);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some(v => v.ruleId === 'LG-000'));
});

test('Disabling or suppressing timeout checks remains visible even if no finding remains', () => {
  for (const result of [
    engine.analyze(ddl, { ignoreRules: ['LG-008'] }),
    engine.analyze('/* lockguard-ignore: LG-008 */ ' + ddl)
  ]) {
    assert.equal(result.violations.length, 0);
    assert.equal(result.coverageComplete, false);
    assert.notEqual(result.status, 'PASSED');
    assert.throws(() => AutoSplitter.generatePlan(result), /incomplete/i);
  }
});

test('PostgreSQL confirms nested BEGIN, savepoint timeout restoration and chained VACUUM rejection', async () => {
  const db = new PGlite();
  const timeout = async () => (await db.query('SHOW lock_timeout')).rows[0].lock_timeout;
  try {
    await db.exec("SET lock_timeout=0; BEGIN; SET lock_timeout='3s'; BEGIN; ROLLBACK;");
    assert.equal(await timeout(), '0');
    await db.exec("BEGIN; SET lock_timeout='3s'; ABORT WORK;");
    assert.equal(await timeout(), '0');
    for (const setting of ['SET', 'SET LOCAL']) {
      await db.exec(`BEGIN; SAVEPOINT before_timeout; ${setting} lock_timeout='3s'; ROLLBACK TO SAVEPOINT before_timeout;`);
      assert.equal(await timeout(), '0');
      await db.exec('ROLLBACK;');
    }
    await db.exec("BEGIN; SAVEPOINT s; SET LOCAL lock_timeout='3s'; RELEASE SAVEPOINT s;");
    assert.equal(await timeout(), '3s');
    await db.exec('ROLLBACK;');
    for (const end of ['COMMIT AND CHAIN', 'ROLLBACK AND CHAIN']) {
      await db.exec(`BEGIN; ${end};`);
      await assert.rejects(db.exec('VACUUM;'), error => error.code === '25001');
      await db.exec('ROLLBACK;');
    }
  } finally { await db.close(); }
});
