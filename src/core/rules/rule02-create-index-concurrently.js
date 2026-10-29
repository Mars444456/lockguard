const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-002',
  code: 'CREATE_INDEX_NON_CONCURRENTLY',
  name: 'Creating index without CONCURRENTLY',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.SHARE,
  description: 'CREATE INDEX without CONCURRENTLY acquires a SHARE lock, completely blocking all INSERT, UPDATE, and DELETE operations until index generation finishes.',
  
  check(astStatements, context = {}) {
    const violations = [];
    const createdTables = context.createdTables || new Set();

    for (const stmt of astStatements) {
      if (stmt.type === 'CREATE_INDEX' && !stmt.isConcurrent) {
        // Safe context: If table was created in this same migration, it is empty
        if (createdTables.has(stmt.table.toLowerCase())) {
          continue;
        }

        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.CRITICAL,
          lockLevel: this.lockLevel,
          table: stmt.table,
          indexName: stmt.indexName,
          columns: stmt.columns,
          line: stmt.line,
          raw: stmt.raw,
          message: `Index '${stmt.indexName}' on table '${stmt.table}' is created without CONCURRENTLY. This takes a SHARE lock and BLOCKS ALL WRITES on production!`
        });
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const indexName = violation.indexName || 'idx_' + table;
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns.join(', ') : 'column_name';

    return [
      `-- Safe alternative: Build index concurrently without blocking writes`,
      `-- NOTE: Must run outside of a multi-statement BEGIN...COMMIT block`,
      `CREATE INDEX CONCURRENTLY ${indexName} ON ${table} (${cols});`
    ].join('\n');
  }
};
