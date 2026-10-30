const { LockLevel, Severity } = require('../types');
const { generatedName } = require('../sql-identifiers');

module.exports = {
  id: 'LG-009',
  code: 'UNSAFE_SET_NOT_NULL',
  name: 'Unsafe ALTER COLUMN SET NOT NULL on existing table',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'ALTER COLUMN SET NOT NULL performs a full table scan while holding an ACCESS EXCLUSIVE lock to verify no NULLs exist, completely freezing the table on production.',

  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    // Track validated check constraints: "table:column"
    const validatedChecks = new Set(context.validatedChecks || (context.sharedState && context.sharedState.validatedChecks) || []);
    const candidateChecks = new Map(); // constraintName -> { table, column }

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'SET_NOT_NULL') sub.hasValidatedNotNullCheck = validatedChecks.has(`${sub.table}:${sub.column}`);
          if (sub.subtype === 'ADD_CHECK_CONSTRAINT' && sub.validatedColumn) {
            candidateChecks.set(`${sub.table}:${sub.constraintName}`, {
              table: sub.table,
              column: sub.validatedColumn
            });
          }
          if (sub.subtype === 'VALIDATE_CONSTRAINT') {
            const key = `${sub.table}:${sub.constraintName}`;
            if (candidateChecks.has(key)) {
              const info = candidateChecks.get(key);
              validatedChecks.add(`${info.table}:${info.column}`);
              if (context.sharedState && context.sharedState.validatedChecks) {
                context.sharedState.validatedChecks.add(`${info.table}:${info.column}`);
              }
            }
          }
          if (sub.subtype === 'DROP_CONSTRAINT') {
            const key = `${sub.table}:${sub.constraintName}`;
            const info = candidateChecks.get(key);
            if (info) validatedChecks.delete(`${info.table}:${info.column}`);
            candidateChecks.delete(key);
          }
        }
      }
    }

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        // Skip tables created in the same migration file
        if (createdTables.has(stmt.table)) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'SET_NOT_NULL') {
            const checkKey = `${sub.table}:${sub.column}`;
            // If already validated via check constraint in this file, it's safe in PG 12+
            if (sub.hasValidatedNotNullCheck) {
              continue;
            }

            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.CRITICAL,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              line: sub.line || stmt.line,
              raw: sub.raw,
              message: `Setting NOT NULL on column '${sub.column}' of table '${sub.table}' scans the entire table under ACCESS EXCLUSIVE lock! It will freeze all reads and writes.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'column_name';
    const constraintName = generatedName(table, column, 'not_null');

    return [
      `-- Safe 4-step recipe for PostgreSQL 12+ (zero-downtime SET NOT NULL):`,
      `-- Step 1: Add CHECK constraint with NOT VALID (instant lock acquisition, no full table scan)`,
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} CHECK (${column} IS NOT NULL) NOT VALID;`,
      ``,
      `-- Step 2: Validate constraint in a separate step (acquires SHARE UPDATE EXCLUSIVE - writes proceed!)`,
      `ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraintName};`,
      ``,
      `-- Step 3: Fast SET NOT NULL (uses already validated check constraint in PG 12+ without scan)`,
      `ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`,
      ``,
      `-- Step 4: Drop redundant check constraint`,
      `ALTER TABLE ${table} DROP CONSTRAINT ${constraintName};`
    ].join('\n');
  }
};
