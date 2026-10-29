const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-001',
  code: 'ADD_COLUMN_WITH_DEFAULT',
  name: 'Adding column with volatile or non-trivial DEFAULT',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Adding a column with a volatile default (now(), uuid(), functions) rewrites the whole table under an ACCESS EXCLUSIVE lock, blocking all SELECT, INSERT, UPDATE, and DELETE queries.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const isLegacyPostgres = context.pgVersion && parseInt(context.pgVersion, 10) < 11;

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_COLUMN' && sub.hasDefault) {
            // Flag if volatile or has non-constant default or running on Postgres < 11
            const isPhysicalRewrite = isLegacyPostgres || !!sub.isPhysicalTableRewrite;
            const isCritical = sub.isVolatileDefault || isLegacyPostgres;
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: isCritical ? Severity.CRITICAL : Severity.HIGH,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              defaultValue: sub.defaultValue,
              isPhysicalTableRewrite: isPhysicalRewrite,
              rewriteReason: isLegacyPostgres ? 'LEGACY_POSTGRES_ALL_DEFAULTS_REWRITE' : (sub.rewriteReason || 'UNKNOWN'),
              line: stmt.line,
              raw: sub.raw,
              message: isPhysicalRewrite 
                ? (isLegacyPostgres 
                    ? `PostgreSQL < 11 does not support fast default evaluation! Adding DEFAULT '${sub.defaultValue}' rewrites the entire table on disk under ACCESS EXCLUSIVE lock!`
                    : `Column '${sub.column}' on table '${sub.table}' has a volatile DEFAULT '${sub.defaultValue}'. This forces a full table rewrite on disk holding ACCESS EXCLUSIVE lock!`)
                : `Column '${sub.column}' on table '${sub.table}' has DEFAULT '${sub.defaultValue}'. In Postgres 11+ metadata is fast, but statement still takes ACCESS EXCLUSIVE lock, risking Head-of-Line queue blocking!`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'new_column';
    const defVal = violation.defaultValue || "'default_value'";

    return [
      `-- Step 1: Add column without default (instant metadata update, no full table rewrite)`,
      `ALTER TABLE ${table} ADD COLUMN ${column} TEXT;`,
      ``,
      `-- Step 2: Set default for future rows`,
      `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defVal};`,
      ``,
      `-- Step 3: Backfill existing rows in small batches (run separately to avoid table lock)`,
      `-- UPDATE ${table} SET ${column} = ${defVal} WHERE ${column} IS NULL;`,
      ``,
      `-- Step 4: If NOT NULL is required, set it after backfill`,
      `-- ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`
    ].join('\n');
  }
};
