const { generatedName } = require('../sql-identifiers');
const { LockLevel, Severity } = require('../types');
const foreignKeyIndexes = require('../foreign-key-indexes');

module.exports = {
  id: 'LG-011',
  code: 'UNINDEXED_FOREIGN_KEY',
  name: 'Adding Foreign Key without supporting index on child columns',
  severity: Severity.MEDIUM,
  lockLevel: LockLevel.SHARE_ROW_EXCLUSIVE,
  description: 'Foreign keys without an index on referencing columns cause table-level lock escalation and sequential scans on the child table whenever rows in the parent table are UPDATED or DELETED.',

  check(astStatements, context = {}) {
    const violations = [];
    for (const { statement: stmt, foreignKey: sub, indexedAtCreation } of context.fkIndexCoverage || foreignKeyIndexes(astStatements, context)) {
      if (!indexedAtCreation) {
        const colList = sub.columns.join(', ');
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
          sourceStart: stmt.sourceStart,
          raw: sub.raw,
          message: `Foreign Key '${sub.constraintName || '(database-assigned name)'}' on '${sub.table} (${colList})' lacks a confirmed supporting index in the supplied context. An UPDATE of referenced keys or DELETE on parent '${sub.foreignTable}' may need a sequential scan of '${sub.table}', increasing runtime and contention. This does not imply table-level lock escalation.`
        });
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    const cols = (violation.columns && violation.columns.length > 0) ? violation.columns : ['foreign_id'];
    const idxName = generatedName('idx',table,...cols);

    return [
      `-- Add supporting index concurrently to prevent cascade lock escalation:`,
      `CREATE INDEX CONCURRENTLY ${idxName} ON ${table} (${cols.join(', ')});`
    ].join('\n');
  }
};
