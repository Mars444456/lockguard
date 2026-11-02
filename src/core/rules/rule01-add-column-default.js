const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-001',
  code: 'ADD_COLUMN_WITH_DEFAULT',
  name: 'Adding column with volatile or non-trivial DEFAULT',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Adding a column with a volatile default (random(), gen_random_uuid(), clock_timestamp()) rewrites the entire table on disk under an ACCESS EXCLUSIVE lock, completely freezing all reads and writes.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const isLegacyPostgres = context.pgVersion && parseInt(context.pgVersion, 10) < 11;

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_COLUMN' && sub.hasDefault) {
            // In PostgreSQL 11+, pure constant literals ('active', 0, false, NULL)
            // and stable expressions (now(), CURRENT_TIMESTAMP)
            // are safe fast metadata-only updates.
            // Only truly volatile expressions (random, gen_random_uuid, clock_timestamp)
            // or legacy PG < 11 force physical table rewrite on disk.
            if (!sub.isTrulyVolatile && sub.defaultVolatility !== 'unknown' && !isLegacyPostgres) {
              continue;
            }

            const isVolatileRewrite = !!sub.isTrulyVolatile || !!sub.isPhysicalTableRewrite;
            const isCritical = isVolatileRewrite || isLegacyPostgres;

            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: isCritical ? Severity.CRITICAL : Severity.HIGH,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              dataType: sub.dataType,
              collation: sub.collation,
              isNotNull: sub.isNotNull,
              defaultValue: sub.defaultValue,
              isPhysicalTableRewrite: sub.defaultVolatility === 'unknown' && !isLegacyPostgres ? null : isVolatileRewrite || isLegacyPostgres,
              rewriteReason: isLegacyPostgres 
                ? 'LEGACY_POSTGRES_ALL_DEFAULTS_REWRITE' 
                : (isVolatileRewrite ? 'VOLATILE_FULL_REWRITE' : 'DEFAULT_VOLATILITY_UNKNOWN'),
              line: sub.line || stmt.line,
              sourceStart: stmt.sourceStart,
              raw: sub.raw,
              message: isVolatileRewrite
                ? `Column '${sub.column}' on table '${sub.table}' has a volatile DEFAULT '${sub.defaultValue}'. This forces a full table rewrite on disk holding ACCESS EXCLUSIVE lock!`
                : (isLegacyPostgres 
                    ? `PostgreSQL < 11 does not support fast default evaluation! Adding DEFAULT '${sub.defaultValue}' rewrites the entire table on disk under ACCESS EXCLUSIVE lock!`
                    : `The volatility and rewrite behavior of DEFAULT '${sub.defaultValue}' cannot be established from SQL alone. Check functions, casts and column type in the target database before release.`)
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    if(violation.rewriteReason==='DEFAULT_VOLATILITY_UNKNOWN')return '-- Inspect function and cast volatility and column-type constraints in the target database. A physical rewrite has not been established; no automatic replacement is generated.';
    const table = violation.table || 'your_table';
    const column = violation.column || 'new_column';
    const defVal = violation.defaultValue || "'default_value'";

    return [
      `-- Step 1: Add column without default (instant metadata update, no full table rewrite)`,
      `ALTER TABLE ${table} ADD COLUMN ${column} ${violation.dataType || 'TEXT'}${violation.collation ? ' COLLATE '+violation.collation : ''};`,
      ``,
      `-- Step 2: Set default for future rows`,
      `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defVal};`,
      ``,
      `-- Step 3: Backfill existing rows in small batches (run separately to avoid table lock)`,
      `-- UPDATE ${table} SET ${column} = ${defVal} WHERE ${column} IS NULL;`,
      ``,
      `-- Step 4: If NOT NULL is required, set it after backfill using zero-downtime pattern`,
      `-- ALTER TABLE ${table} ADD CONSTRAINT ${table}_${column}_not_null CHECK (${column} IS NOT NULL) NOT VALID;`,
      `-- ALTER TABLE ${table} VALIDATE CONSTRAINT ${table}_${column}_not_null;`,
      `-- ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`,
      `-- ALTER TABLE ${table} DROP CONSTRAINT ${table}_${column}_not_null;`
    ].join('\n');
  }
};
