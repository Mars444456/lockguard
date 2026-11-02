const { LockLevel, Severity } = require('../types');
const { quote } = require('../schema-catalog');
const { classify } = require('../column-types');

module.exports = {
  id: 'LG-004',
  code: 'ALTER_COLUMN_TYPE_REWRITE',
  name: 'Column type change requires review',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'A type change acquires ACCESS EXCLUSIVE. A heap rewrite depends on source/target types, USING, collation and PostgreSQL version.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();
    const catalog = context.schemaCatalog, state = new Map();
    let allowUnqualified = true;
    let pathEpoch = 0;

    for (const stmt of astStatements) {
      if (['SET_VARIABLE','RESET_VARIABLE'].includes(stmt.type) && ['search_path','all'].includes(stmt.variable)) {allowUnqualified = false;pathEpoch++;}
      const baseline = catalog?.lookup(stmt.table || '', allowUnqualified);
      const key = baseline ? JSON.stringify([baseline.schema,baseline.name]) : JSON.stringify([pathEpoch,stmt.table]);
      if (!state.has(key)) state.set(key, new Map((baseline?.columns || []).map(c => [quote(c.name),c.type])));
      const columns = state.get(key);
      if (['DROP_TABLE','CREATE_TABLE'].includes(stmt.type)) columns.clear();
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        // Safe context: If table was created in this same migration, it is empty
        if (createdTables.has(stmt.table)) {
          continue;
        }

        for (const sub of stmt.subcommands) {
          if (['DROP_COLUMN','ADD_COLUMN'].includes(sub.subtype)) columns.delete(sub.column);
          if (sub.subtype === 'UNSUPPORTED') columns.clear();
          if (sub.subtype === 'ALTER_COLUMN_TYPE') {
            const sourceType = columns.get(sub.column) || null;
            const version = context.pgVersion || catalog?.pgVersion || 17;
            const rewrite = classify(sourceType,sub.targetType,{version,using:sub.hasUsing,collation:sub.hasCollation,
              versionMismatch:!!catalog && !!context.pgVersion && context.pgVersion !== catalog.pgVersion});
            columns.set(sub.column,sub.targetType);
            const explanation = rewrite === 'not-required'
              ? 'The known widening VARCHAR change does not require a heap rewrite. ACCESS EXCLUSIVE is still acquired; indexes and dependencies need review.'
              : rewrite === 'required' ? 'The known integer storage types differ; this change requires a heap rewrite under ACCESS EXCLUSIVE.'
              : 'A heap rewrite may be required. Verify the source type, USING, collation and PostgreSQL version. ACCESS EXCLUSIVE is still acquired.';
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: rewrite === 'not-required' ? Severity.MEDIUM : Severity.CRITICAL,
              lockLevel: this.lockLevel,
              table: sub.table,
              column: sub.column,
              newType: sub.newType,
              line: sub.line || stmt.line,
              raw: sub.raw,
              rewrite, sourceType, targetType:sub.targetType,
              evidence:{source:sourceType ? baseline ? 'imported_schema_and_sql' : 'earlier_sql' : 'sql_only', certainty:rewrite === 'unknown' ? 'requires_database_review' : baseline ? 'conditional_on_snapshot' : 'conditional_on_execution',
                pgVersion:version, verifiedAgainstDatabase:false, rewrite,
                missing:rewrite === 'unknown' ? ['Verify source type, USING, collation, dependencies and PostgreSQL version.'] : ['Verify snapshot freshness, dependencies and runtime lock waits.']},
              message: `Change '${sub.table}.${sub.column}' to ${sub.newType}. ${explanation}`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    return [
      '-- Review template only. DDL acquires locks; duration and downtime are not measured.',
      '-- Verify source type, USING/collation, constraints, defaults, indexes and application dependencies.',
      violation.rewrite === 'not-required' ? '-- A shadow-column migration is not indicated by this known widening VARCHAR conversion.'
        : '-- If expand/contract is needed, design dual-write and a bounded backfill for this schema.',
      '-- Confirm data consistency and application compatibility before any column swap or cleanup.',
      '-- Test the complete migration in an isolated representative database.'
    ].join('\n');
  }
};
