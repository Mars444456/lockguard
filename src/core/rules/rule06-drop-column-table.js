const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-006',
  code: 'DROP_TABLE_OR_COLUMN_DIRECT',
  name: 'Immediate DROP COLUMN or DROP TABLE in monolithic step',
  severity: Severity.HIGH,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Dropping a table or column acquires ACCESS EXCLUSIVE and can break queries or deployed application versions that still depend on the object.',
  
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
          sourceStart: stmt.sourceStart,
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
              sourceStart: stmt.sourceStart,
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
    return [
      '-- Manual deprecation review required before executing the original DROP.',
      '-- Remove application dependencies across all deployed versions and background jobs.',
      '-- Inventory dependent constraints, views, triggers and CASCADE effects.',
      '-- Verify a restorable backup, recovery plan and an appropriate lock timeout.',
      '-- No replacement destructive SQL is generated.'
    ].join('\n');
  }
};
