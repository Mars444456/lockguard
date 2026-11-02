const { LockLevel, Severity } = require('../types');
const {unique}=require('../sql-rewrite');

module.exports = {
  id: 'LG-005',
  code: 'ADD_UNIQUE_CONSTRAINT_DIRECT',
  name: 'Adding UNIQUE constraint directly without concurrent index',
  severity: Severity.HIGH,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Adding a UNIQUE constraint directly creates an underlying unique index under an ACCESS EXCLUSIVE lock. Writes and reads are blocked during index creation.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        if (createdTables.has(stmt.table)) {
          continue;
        }

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
              nullsNotDistinct:sub.nullsNotDistinct,deferrable:sub.deferrable,initiallyDeferred:sub.initiallyDeferred,
              including:sub.including,tablespace:sub.tablespace,uniqueOptionsUnsupported:sub.uniqueOptionsUnsupported,
              line: stmt.line,
              sourceStart: stmt.sourceStart,
              raw: sub.raw,
              message: `UNIQUE constraint '${sub.constraintName || '(database-assigned name)'}' on '${sub.table}' is added directly. Review CREATE UNIQUE INDEX CONCURRENTLY + ADD CONSTRAINT USING INDEX instead.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const sql=unique(violation);if(!sql)return '-- Review the original UNIQUE options; no equivalent replacement was established.';

    return [
      `-- Step 1: Create unique index concurrently without blocking writes`,
      sql.create,
      ``,
      `-- Step 2: Attach the index, preserving deferrability; lock acquisition can still wait.`,
      sql.attach
    ].join('\n');
  }
};
