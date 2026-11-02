const { LockLevel, Severity } = require('../types');
const { generatedName } = require('../sql-identifiers');
const { quote } = require('../schema-catalog');

module.exports = {
  id: 'LG-009',
  code: 'UNSAFE_SET_NOT_NULL',
  name: 'Unsafe ALTER COLUMN SET NOT NULL on existing table',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'ALTER COLUMN SET NOT NULL can scan the table under ACCESS EXCLUSIVE unless the target version and supplied constraints establish that validation is unnecessary. Lock waits and duration need runtime review.',

  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    // Track validated check constraints: "table:column"
    let validatedChecks = new Set(context.validatedChecks || (context.sharedState && context.sharedState.validatedChecks) || []);
    let candidateChecks = new Map(); // constraintName -> { table, column }
    const catalog = context.schemaCatalog;
    const pgVersion = context.pgVersion ?? catalog?.pgVersion ?? 17;
    let transactionStart = context.transactionWrapped ? {checks:new Set(validatedChecks),candidates:new Map(candidateChecks)} : null;
    let allowUnqualified = true;
    const invalidatedTables = new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'TRANSACTION_START' && !transactionStart) transactionStart={checks:new Set(validatedChecks),candidates:new Map(candidateChecks)};
      if (stmt.type === 'TRANSACTION_COMMIT') {
        if(stmt.pgAst?.kind==='TRANS_STMT_ROLLBACK' && transactionStart){validatedChecks=transactionStart.checks;candidateChecks=transactionStart.candidates;}
        transactionStart=stmt.pgAst?.chain?{checks:new Set(validatedChecks),candidates:new Map(candidateChecks)}:null;
      }
      if (['SET_VARIABLE', 'RESET_VARIABLE'].includes(stmt.type) && ['search_path', 'all'].includes(stmt.variable)) { allowUnqualified = false; validatedChecks.clear(); candidateChecks.clear(); }
      const dropsConstraint=stmt.subcommands?.some(sub=>sub.subtype==='DROP_CONSTRAINT');
      if(stmt.type==='DROP_TABLE' || stmt.subcommands?.some(sub=>['DROP_COLUMN','DROP_CONSTRAINT','ALTER_COLUMN_TYPE','UNSUPPORTED'].includes(sub.subtype))){
        // Shared proofs have no durable constraint/object identity. Invalidate
        // conservatively, including aliases such as items versus public.items.
        validatedChecks.clear();candidateChecks.clear();
      }
      const baseline = catalog?.lookup(stmt.table || '', allowUnqualified);
      if (stmt.type === 'DROP_TABLE' || stmt.subcommands?.some(sub => ['DROP_COLUMN', 'DROP_CONSTRAINT', 'DROP_NOT_NULL', 'ALTER_COLUMN_TYPE', 'UNSUPPORTED'].includes(sub.subtype))) {
        if (baseline) invalidatedTables.add(baseline);
      }
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'SET_NOT_NULL') {
            const existing = baseline && !invalidatedTables.has(baseline) &&
              (baseline.columns.some(c => quote(c.name) === sub.column && c.notNull) ||
                (pgVersion >= 12 && baseline.checks.some(c => quote(c.column) === sub.column && c.validated)));
            sub.hasValidatedNotNullCheck = !dropsConstraint && ((validatedChecks.has(`${sub.table}:${sub.column}`) && pgVersion >= 12) || !!existing);
          }
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

    if(context.sharedState?.validatedChecks){
      const committedChecks=transactionStart?transactionStart.checks:validatedChecks;
      context.sharedState.validatedChecks.clear();
      for(const key of committedChecks)context.sharedState.validatedChecks.add(key);
    }

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        // Skip tables created in the same migration file
        if (createdTables.has(stmt.table)) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'SET_NOT_NULL') {
            // A validated proof can avoid the scan in PG 12+; the DDL lock remains.
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
              sourceStart: stmt.sourceStart,
              raw: sub.raw,
              message: `Setting NOT NULL on column '${sub.column}' of table '${sub.table}' may scan the table under ACCESS EXCLUSIVE. The supplied context does not establish that validation can be skipped on PostgreSQL ${pgVersion}; review lock waits and duration on the target database.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation, context = {}) {
    const table = violation.table || 'your_table';
    const column = violation.column || 'column_name';
    const constraintName = generatedName(table, column, 'not_null');

    if((context.pgVersion ?? 17)<12)return '-- PostgreSQL 10–11 cannot use the validated-CHECK optimization for SET NOT NULL. Review validation scans and lock acquisition on the target database; no scan-free enforcement recipe is established.';

    return [
      `-- Draft for PostgreSQL 12+: verify each step and lock acquisition on the target database.`,
      `-- Step 1: Add CHECK constraint with NOT VALID (no initial validation scan; lock acquisition may wait)`,
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
