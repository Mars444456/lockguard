const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-012',
  code: 'TRUNCATE_AND_MATERIALIZED_VIEW_LOCKS',
  name: 'Unsafe TRUNCATE or non-concurrent REFRESH MATERIALIZED VIEW',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'TRUNCATE and non-concurrent REFRESH MATERIALIZED VIEW acquire an ACCESS EXCLUSIVE lock on the table/view, completely blocking all reads and writes until execution finishes.',

  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      // 1. TRUNCATE TABLE
      if (stmt.type === 'TRUNCATE_TABLE') {
        const tables = stmt.tables || [stmt.table];
        for (const tbl of tables) {
          if (createdTables.has(tbl)) {
            continue;
          }

          violations.push({
            ruleId: this.id,
            ruleCode: this.code,
            ruleName: this.name,
            severity: Severity.CRITICAL,
            lockLevel: this.lockLevel,
            table: tbl,
            operationType: 'TRUNCATE',
            line: stmt.line,
            raw: stmt.raw,
            message: `TRUNCATE TABLE '${tbl}' acquires an ACCESS EXCLUSIVE lock and blocks all concurrent transactions. Use batched DELETE or partition rotation instead.`
          });
        }
      }

      // 2. REFRESH MATERIALIZED VIEW without CONCURRENTLY
      if (stmt.type === 'REFRESH_MATVIEW' && !stmt.isConcurrent) {
        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.CRITICAL,
          lockLevel: this.lockLevel,
          table: stmt.view || stmt.table,
          operationType: 'REFRESH_MATVIEW',
          line: stmt.line,
          raw: stmt.raw,
          message: `REFRESH MATERIALIZED VIEW '${stmt.view}' without CONCURRENTLY acquires an ACCESS EXCLUSIVE lock, completely blocking all SELECT queries against the view until refresh completes!`
        });
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    if (violation.operationType === 'REFRESH_MATVIEW') {
      const view = violation.table || 'your_matview';
      return [
        `-- Safe alternative: Refresh concurrently without blocking reads`,
        `-- (Note: Requires a unique index on the materialized view)`,
        `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view};`
      ].join('\n');
    }

    const table = violation.table || 'your_table';
    return [
      `-- Safe alternative to TRUNCATE on live table:`,
      `-- Option 1: Batched DELETE loop to prevent table locking`,
      `DO $$`,
      `DECLARE`,
      `  deleted_count INT;`,
      `BEGIN`,
      `  LOOP`,
      `    DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} LIMIT 5000);`,
      `    GET DIAGNOSTICS deleted_count = ROW_COUNT;`,
      `    EXIT WHEN deleted_count = 0;`,
      `    COMMIT;`,
      `  END LOOP;`,
      `END $$;`
    ].join('\n');
  }
};
