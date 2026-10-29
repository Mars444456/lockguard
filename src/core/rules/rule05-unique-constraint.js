const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-005',
  code: 'ADD_UNIQUE_CONSTRAINT_DIRECT',
  name: 'Adding UNIQUE constraint directly without concurrent index',
  severity: Severity.HIGH,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Adding a UNIQUE constraint directly creates an underlying unique index under an ACCESS EXCLUSIVE lock. Writes and reads are blocked during index creation.',
  
  check(astStatements) {
    const violations = [];

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_UNIQUE_CONSTRAINT' && !sub.isUsingIndex) {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.HIGH,
              lockLevel: this.lockLevel,
              table: sub.table,
              constraintName: sub.constraintName,
              columns: sub.columns,
              line: stmt.line,
              raw: sub.raw,
              message: `UNIQUE constraint '${sub.constraintName}' on '${sub.table}' is added directly. Use CREATE UNIQUE INDEX CONCURRENTLY + ADD CONSTRAINT USING INDEX instead.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const constraint = violation.constraintName || 'uq_' + table;
    const indexName = constraint + '_idx';
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns.join(', ') : 'column_name';

    return [
      `-- Step 1: Create unique index concurrently without blocking writes`,
      `CREATE UNIQUE INDEX CONCURRENTLY ${indexName} ON ${table} (${cols});`,
      ``,
      `-- Step 2: Attach constraint using existing index (instant catalog operation)`,
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} UNIQUE USING INDEX ${indexName};`
    ].join('\n');
  }
};
