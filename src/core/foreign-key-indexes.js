const SchemaCatalog = require('./schema-catalog');

// Share index evidence between LG-011 and the dependency graph. LG-011 checks
// FK creation; the graph describes index coverage after the inspected script.
function foreignKeyIndexes(astStatements, context = {}) {
  const catalog = context.schemaCatalog;
  let indexes = [];
  const disabledTables = new Set(), droppedIndexes = new Set();
  let allowUnqualified = true;
  const foreignKeys = [];

  function hasSupportingIndex(sub) {
    const table = sub.table, cols = sub.columns;
    const baseline = catalog?.lookup(table, allowUnqualified);
    const hasNewIndex = indexes.some(index => (allowUnqualified || (index.table.includes('.') && table.includes('.'))) &&
      (index.table === table || (baseline && catalog.lookup(index.table, allowUnqualified) === baseline)) &&
      cols.every((col, i) => index.columns[i] === col));
    const hasExistingIndex = baseline && !disabledTables.has(baseline) && baseline.indexes.some(index =>
      index.valid && !index.partial && !index.expression && !index.customSemantics && index.method === 'btree' &&
      !droppedIndexes.has(index.name) && cols.every((col, i) => SchemaCatalog.quote(index.columns[i] || '') === col));
    return Boolean(hasNewIndex || hasExistingIndex);
  }

  for (const stmt of astStatements) {
    if (['SET_VARIABLE', 'RESET_VARIABLE'].includes(stmt.type) && ['search_path', 'all'].includes(stmt.variable)) {
      allowUnqualified = false;
      indexes = [];
    }
    if (stmt.type === 'CREATE_INDEX' && !stmt.pgAst?.if_not_exists && !stmt.isPartial && stmt.accessMethod === 'btree' &&
      !stmt.columns.includes('(expression)') &&
      !stmt.pgAst?.indexParams?.some(p => p.IndexElem.collation?.length || p.IndexElem.opclass?.length)) indexes.push(stmt);
    if (stmt.type === 'DROP_INDEX') {
      for (const item of stmt.pgAst?.objects || []) {
        const names = item.List?.items?.map(v => v.String.sval) || [];
        if (names.length) droppedIndexes.add(names.at(-1));
      }
      indexes = indexes.filter(index => !droppedIndexes.has(index.pgAst?.idxname));
    }
    if (stmt.type === 'DROP_TABLE' || stmt.subcommands?.some(sub => ['DROP_COLUMN', 'DROP_CONSTRAINT', 'ALTER_COLUMN_TYPE', 'UNSUPPORTED'].includes(sub.subtype))) {
      const table = catalog?.lookup(stmt.table || '', allowUnqualified);
      if (table) disabledTables.add(table);
      indexes = indexes.filter(index => index.table !== stmt.table);
    }
    if (stmt.type === 'ALTER_TABLE') {
      for (const sub of stmt.subcommands || []) {
        if (sub.subtype === 'ADD_FOREIGN_KEY' && sub.columns?.length) {
          foreignKeys.push({ statement: stmt, foreignKey: sub, indexedAtCreation: hasSupportingIndex(sub) });
        }
      }
    }
  }
  return foreignKeys.map(item => ({ ...item, indexedAtEnd: hasSupportingIndex(item.foreignKey) }));
}

module.exports = foreignKeyIndexes;
