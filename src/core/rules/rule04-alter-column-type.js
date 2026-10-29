const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-004',
  code: 'ALTER_COLUMN_TYPE_REWRITE',
  name: 'Altering column type causing full table rewrite',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Changing a column data type (e.g. INT to BIGINT, VARCHAR to INT) requires a complete rewrite of the table and all its indexes under an ACCESS EXCLUSIVE lock.',
  
  check(astStatements) {
    const violations = [];

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
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
              line: stmt.line,
              raw: sub.raw,
              message: `Altering column '${sub.column}' type to '${sub.newType}' on table '${sub.table}' requires full table rewrite and index rebuilds under ACCESS EXCLUSIVE lock!`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'target_column';
    const newType = violation.newType || 'BIGINT';

    return [
      `-- Safe Multi-Step Migration Pattern for Column Type Changes:`,
      `-- Step 1: Add a new column with the target type`,
      `ALTER TABLE ${table} ADD COLUMN ${column}_new ${newType};`,
      ``,
      `-- Step 2: Backfill existing rows in batches`,
      `-- UPDATE ${table} SET ${column}_new = ${column}::${newType} WHERE ${column}_new IS NULL;`,
      ``,
      `-- Step 3: Swap columns (quick metadata lock)`,
      `ALTER TABLE ${table} RENAME COLUMN ${column} TO ${column}_old;`,
      `ALTER TABLE ${table} RENAME COLUMN ${column}_new TO ${column};`,
      ``,
      `-- Step 4: Drop old column in a later maintenance deploy after verifying data integrity`,
      `-- ALTER TABLE ${table} DROP COLUMN ${column}_old;`
    ].join('\n');
  }
};
