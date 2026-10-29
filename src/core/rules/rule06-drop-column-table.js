const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-006',
  code: 'DROP_TABLE_OR_COLUMN_DIRECT',
  name: 'Immediate DROP COLUMN or DROP TABLE in monolithic step',
  severity: Severity.HIGH,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Dropping a table or column immediately takes an ACCESS EXCLUSIVE lock and crashes application code or replicas holding cached queries or ORM models.',
  
  check(astStatements) {
    const violations = [];

    for (const stmt of astStatements) {
      if (stmt.type === 'DROP_TABLE') {
        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.HIGH,
          lockLevel: this.lockLevel,
          table: stmt.tables.join(', '),
          line: stmt.line,
          raw: stmt.raw,
          message: `DROP TABLE '${stmt.tables.join(', ')}' in single step. Ensure tables are completely removed from ORM and all services before dropping.`
        });
      }

      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'DROP_COLUMN') {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.HIGH,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              line: stmt.line,
              raw: sub.raw,
              message: `DROP COLUMN '${sub.column}' on '${sub.table}' executed directly. Ensure column is ignored in ORM (Prisma/Drizzle/Alembic) prior to dropping.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'old_column';

    return [
      `-- Safe 3-Phase Deprecation Workflow:`,
      `-- Phase 1: Deploy code ignoring the column in your ORM (e.g. Prisma @ignore or schema exclude)`,
      `-- Phase 2: Verify zero active queries access the column`,
      `-- Phase 3: Drop column safely:`,
      `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column};`
    ].join('\n');
  }
};
