const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-011',
  code: 'UNINDEXED_FOREIGN_KEY',
  name: 'Adding Foreign Key without supporting index on child columns',
  severity: Severity.MEDIUM,
  lockLevel: LockLevel.SHARE_ROW_EXCLUSIVE,
  description: 'Foreign keys without an index on referencing columns cause table-level lock escalation and sequential scans on the child table whenever rows in the parent table are UPDATED or DELETED.',

  check(astStatements, context = {}) {
    const violations = [];
    const indexes = [];

    // Gather indexes created in the current migration file
    for (const stmt of astStatements) {
      if (stmt.type === 'CREATE_INDEX' && stmt.table && stmt.columns) {
        if (!stmt.isPartial && stmt.accessMethod === 'btree' && !stmt.columns.includes('(expression)')) indexes.push(stmt);
      }
    }

    for (const stmt of astStatements) {
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_FOREIGN_KEY' && sub.columns && sub.columns.length > 0) {
            const table = sub.table;
            const cols = sub.columns.map(c => c);

            // Check if all FK columns have an index
            const hasIndex = indexes.some(index => index.table === table &&
              cols.every((col, i) => index.columns[i] === col));

            if (!hasIndex) {
              const colList = sub.columns.join(', ');
              const cleanColName = sub.columns.join('_').replace(/[^a-zA-Z0-9_]/g, '');

              violations.push({
                ruleId: this.id,
                ruleCode: this.code,
                ruleName: this.name,
                severity: Severity.MEDIUM,
                lockLevel: this.lockLevel,
                table: sub.table,
                foreignTable: sub.foreignTable,
                constraintName: sub.constraintName,
                columns: sub.columns,
                line: sub.line || stmt.line,
                raw: sub.raw,
                message: `Foreign Key '${sub.constraintName}' on '${sub.table} (${colList})' lacks a supporting index. Any UPDATE or DELETE on parent '${sub.foreignTable}' will lock and sequentially scan '${sub.table}'!`
              });
            }
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns : ['foreign_id'];
    const idxName = `idx_${table}_${cols.join('_').replace(/[^a-zA-Z0-9_]/g, '')}`;

    return [
      `-- Add supporting index concurrently to prevent cascade lock escalation:`,
      `CREATE INDEX CONCURRENTLY ${idxName} ON ${table} (${cols.join(', ')});`
    ].join('\n');
  }
};
