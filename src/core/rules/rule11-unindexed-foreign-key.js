const { LockLevel, Severity } = require('../types');
const SchemaCatalog = require('../schema-catalog');

module.exports = {
  id: 'LG-011',
  code: 'UNINDEXED_FOREIGN_KEY',
  name: 'Adding Foreign Key without supporting index on child columns',
  severity: Severity.MEDIUM,
  lockLevel: LockLevel.SHARE_ROW_EXCLUSIVE,
  description: 'Foreign keys without an index on referencing columns cause table-level lock escalation and sequential scans on the child table whenever rows in the parent table are UPDATED or DELETED.',

  check(astStatements, context = {}) {
    const violations = [];
    let indexes = [];
    const catalog = context.schemaCatalog;
    const disabledTables = new Set(), droppedIndexes = new Set();
    let allowUnqualified = true;

    for (const stmt of astStatements) {
      if (['SET_VARIABLE', 'RESET_VARIABLE'].includes(stmt.type) && ['search_path', 'all'].includes(stmt.variable)) { allowUnqualified = false; indexes = []; }
      if (stmt.type === 'CREATE_INDEX' && !stmt.pgAst?.if_not_exists && !stmt.isPartial && stmt.accessMethod === 'btree' && !stmt.columns.includes('(expression)') &&
        !stmt.pgAst?.indexParams?.some(p => p.IndexElem.collation?.length || p.IndexElem.opclass?.length)) indexes.push(stmt);
      if (stmt.type === 'DROP_INDEX') {
        for (const item of stmt.pgAst?.objects || []) {
          const names = item.List?.items?.map(v => v.String.sval) || [];
          if (names.length) droppedIndexes.add(names.at(-1));
        }
        indexes = indexes.filter(i => !droppedIndexes.has(i.pgAst?.idxname));
      }
      if (stmt.type === 'DROP_TABLE' || stmt.subcommands?.some(sub => ['DROP_COLUMN', 'DROP_CONSTRAINT', 'ALTER_COLUMN_TYPE', 'UNSUPPORTED'].includes(sub.subtype))) {
        const table = catalog?.lookup(stmt.table || '', allowUnqualified); if (table) disabledTables.add(table);
        indexes = indexes.filter(i => i.table !== stmt.table);
      }
      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'ADD_FOREIGN_KEY' && sub.columns && sub.columns.length > 0) {
            const table = sub.table;
            const cols = sub.columns.map(c => c);

            // Check if all FK columns have an index
            const baseline = catalog?.lookup(table, allowUnqualified);
            const hasNewIndex = indexes.some(index => (allowUnqualified || (index.table.includes('.') && table.includes('.'))) &&
              (index.table === table || (baseline && catalog.lookup(index.table, allowUnqualified) === baseline)) && cols.every((col, i) => index.columns[i] === col));
            const hasExistingIndex = baseline && !disabledTables.has(baseline) && baseline.indexes.some(index => index.valid && !index.partial && !index.expression && !index.customSemantics && index.method === 'btree' && !droppedIndexes.has(index.name) &&
              cols.every((col, i) => SchemaCatalog.quote(index.columns[i] || '') === col));
            const hasIndex = hasNewIndex || hasExistingIndex;

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
