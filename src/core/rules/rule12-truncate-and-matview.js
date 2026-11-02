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
            sourceStart: stmt.sourceStart,
            raw: stmt.raw,
            message: `TRUNCATE TABLE '${tbl}' acquires ACCESS EXCLUSIVE and blocks access to this relation. Review dependencies, triggers, identity handling and maintenance strategy; DELETE is not an equivalent replacement.`
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
          withNoData:stmt.withNoData,
          line: stmt.line,
          sourceStart: stmt.sourceStart,
          raw: stmt.raw,
          message: `REFRESH MATERIALIZED VIEW '${stmt.view}' without CONCURRENTLY acquires an ACCESS EXCLUSIVE lock, completely blocking all SELECT queries against the view until refresh completes!`
        });
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    if (violation.operationType === 'REFRESH_MATVIEW') {
      if(violation.withNoData)return '-- WITH NO DATA intentionally leaves the view unpopulated. It cannot be combined with CONCURRENTLY; review the original operation and dependencies.';
      const view = violation.table || 'your_matview';
      return [
        `-- Safe alternative: Refresh concurrently without blocking reads`,
        `-- Requires an already populated view and a valid UNIQUE index covering all rows using plain columns.`,
        `-- Check eligibility and application behavior in the target database before execution.`,
        `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view};`
      ].join('\n');
    }

    return [
      '-- Manual data-removal strategy required. No destructive replacement is generated.',
      '-- DELETE differs from TRUNCATE in trigger, foreign-key, identity, MVCC and space-reclamation behavior.',
      '-- Review CASCADE / RESTART IDENTITY, all affected relations and recovery requirements.',
      '-- Test a maintenance window, partition strategy or explicitly approved bounded DELETE separately.'
    ].join('\n');
  }
};
