const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-003',
  code: 'FOREIGN_KEY_WITHOUT_NOT_VALID',
  name: 'Adding Foreign Key without NOT VALID',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.SHARE_ROW_EXCLUSIVE,
  description: 'Adding a foreign key without NOT VALID validates existing rows while holding SHARE ROW EXCLUSIVE on the referencing and referenced tables. Ordinary reads remain compatible, but concurrent writes can wait.',
  
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
              foreignColumns: sub.foreignColumns,
              line: sub.line || stmt.line,
              raw: sub.raw,
              message: `Foreign Key '${sub.constraintName}' on '${sub.table}' referencing '${sub.foreignTable}' lacks 'NOT VALID'. Validation holds SHARE ROW EXCLUSIVE on both tables and can block concurrent writes; ordinary SELECT remains compatible.`
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
      `-- Step 1: Add foreign key with NOT VALID (skips the initial scan; lock acquisition can still wait)`,
      violation.raw
        ? `${/^ALTER\s+TABLE/i.test(violation.raw) ? violation.raw : `ALTER TABLE ${table} ${violation.raw}`} NOT VALID;`
        : `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${cols}) REFERENCES ${foreignTable}${violation.foreignColumns?.length ? `(${violation.foreignColumns.join(', ')})` : ''} NOT VALID;`,
      ``,
      `-- Step 2: Validate existing rows in a separate statement (acquires only SHARE UPDATE EXCLUSIVE - writes proceed!)`,
      `ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint};`
    ].join('\n');
  }
};
