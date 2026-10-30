const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-004',
  code: 'ALTER_COLUMN_TYPE_REWRITE',
  name: 'Altering column type causing full table rewrite',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Changing a column data type (e.g. INT to BIGINT, VARCHAR to INT) requires a complete rewrite of the table and all its indexes under an ACCESS EXCLUSIVE lock.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        // Safe context: If table was created in this same migration, it is empty
        if (createdTables.has(stmt.table)) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ALTER_COLUMN_TYPE') {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.CRITICAL,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              newType: sub.newType,
              line: sub.line || stmt.line,
              raw: sub.raw,
              message: `Altering type of column '${sub.column}' to '${sub.newType}' on table '${sub.table}' forces a full table rewrite on disk under ACCESS EXCLUSIVE lock!`
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
    const newType = violation.newType || 'BIGINT';
    const tempCol = `${column}_new`;

    return [
      `-- Safe 4-phase transition without downtime (dual-writing pattern):`,
      `-- Phase 1: Add new column without locking table`,
      `ALTER TABLE ${table} ADD COLUMN ${tempCol} ${newType};`,
      ``,
      `-- Phase 2: Create trigger / dual-write in application code for incoming writes`,
      `-- Backfill historical rows in small batches:`,
      `-- UPDATE ${table} SET ${tempCol} = ${column} WHERE ${tempCol} IS NULL;`,
      ``,
      `-- Phase 3: Rename columns in a quick metadata lock`,
      `-- ALTER TABLE ${table} RENAME COLUMN ${column} TO ${column}_old;`,
      `-- ALTER TABLE ${table} RENAME COLUMN ${tempCol} TO ${column};`,
      ``,
      `-- Phase 4: Drop old column in later release`,
      `-- ALTER TABLE ${table} DROP COLUMN ${column}_old;`
    ].join('\n');
  }
};
