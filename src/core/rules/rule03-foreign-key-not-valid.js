const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-003',
  code: 'FOREIGN_KEY_WITHOUT_NOT_VALID',
  name: 'Adding Foreign Key without NOT VALID',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Adding a foreign key constraint without NOT VALID performs a full table scan while holding an ACCESS EXCLUSIVE lock, freezing the table during row validation.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        // Safe context: If table was created in this same migration, it is empty
        if (createdTables.has(stmt.table.toLowerCase())) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_FOREIGN_KEY' && !sub.isNotValid) {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.CRITICAL,
              lockLevel: this.lockLevel,
              table: sub.table,
              constraintName: sub.constraintName,
              foreignTable: sub.foreignTable,
              columns: sub.columns,
              line: sub.line || stmt.line,
              raw: sub.raw,
              message: `Foreign Key '${sub.constraintName}' on '${sub.table}' referencing '${sub.foreignTable}' lacks 'NOT VALID'. It blocks all reads/writes during table validation!`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const constraint = violation.constraintName || 'fk_' + table;
    const foreignTable = violation.foreignTable || 'target_table';
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns.join(', ') : 'foreign_id';

    return [
      `-- Step 1: Add foreign key with NOT VALID (instant lock acquisition, no full table scan)`,
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${cols}) REFERENCES ${foreignTable}(id) NOT VALID;`,
      ``,
      `-- Step 2: Validate existing rows in a separate statement (acquires only SHARE UPDATE EXCLUSIVE - writes proceed!)`,
      `ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint};`
    ].join('\n');
  }
};
