const pg = require('libpg-query');
const quote = name => /^[a-z_][a-z0-9_]*$/.test(name) ? name : '"' + name.replace(/"/g, '""') + '"';
function invalid(message) { throw Object.assign(new Error('Схема: ' + message), { statusCode: 400 }); }
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('ожидался объект.');
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid('неизвестные поля. Загружайте только структуру, без строк данных.');
}
function name(value) {
  if (typeof value !== 'string' || !value || /\0/.test(value) || new TextEncoder().encode(value).length > 63) invalid('имя должно содержать от 1 до 63 байт.');
  return value;
}
function list(value, limit) { if (!Array.isArray(value) || value.length > limit) invalid('превышен размер списка.'); return value; }
function bool(value, fallback = false) { if (value === undefined) return fallback; if (typeof value !== 'boolean') invalid('ожидалось логическое значение.'); return value; }
const strings = values => (values || []).map(v => v.String.sval);
function parts(sqlName) {
  const values = sqlName.match(/"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*/g) || [];
  if (values.join('.') !== sqlName || values.length > 2) return [];
  return values.map(v => v.startsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v);
}
function notNullColumn(expr) {
  const node = expr?.NullTest;
  return node?.nulltesttype === 'IS_NOT_NULL' && node.arg?.ColumnRef?.fields?.length === 1 ? node.arg.ColumnRef.fields[0].String?.sval : null;
}

class SchemaCatalog {
  constructor(input) {
    object(input, ['version', 'pgVersion', 'defaultSchema', 'tables']);
    if (input.version !== 1) invalid('поддерживается формат version: 1.');
    if (!Number.isInteger(input.pgVersion) || input.pgVersion < 10 || input.pgVersion > 18) invalid('pgVersion должен быть от 10 до 18.');
    this.version = 1; this.pgVersion = input.pgVersion; this.defaultSchema = name(input.defaultSchema || 'public');
    let indexes = 0, columns = 0;
    this.tables = list(input.tables, 500).map(table => {
      object(table, ['schema', 'name', 'columns', 'indexes', 'checks']);
      const result = { schema: name(table.schema || this.defaultSchema), name: name(table.name),
        columns: list(table.columns || [], 1600).map(c => {
          object(c, ['name', 'notNull']); columns++;
          return { name: name(c.name), notNull: bool(c.notNull) };
        }),
        indexes: list(table.indexes || [], 200).map(i => {
          object(i, ['name', 'columns', 'method', 'valid', 'partial', 'expression', 'customSemantics']); indexes++;
          if (i.method !== undefined && typeof i.method !== 'string') invalid('неверный метод индекса.');
          return { name: name(i.name), columns: list(i.columns || [], 32).map(name), method: i.method || 'btree',
            valid: bool(i.valid, true), partial: bool(i.partial), expression: bool(i.expression), customSemantics: bool(i.customSemantics) };
        }),
        checks: list(table.checks || [], 200).map(c => {
          object(c, ['name', 'column', 'validated', 'enforced']);
          if(c.enforced===false && c.validated===true)invalid('неисполняемый CHECK не может быть подтверждённым.');
          return { name: name(c.name), column: name(c.column), validated: bool(c.validated), enforced: bool(c.enforced,true) };
        }) };
      if (new Set(result.columns.map(c => c.name)).size !== result.columns.length) invalid('повторяющееся имя столбца.');
      for (const i of result.indexes) if (i.columns.some(c => !result.columns.some(col => col.name === c))) invalid('индекс ссылается на неизвестный столбец.');
      for (const c of result.checks) if (!result.columns.some(col => col.name === c.column)) invalid('CHECK ссылается на неизвестный столбец.');
      return result;
    });
    if (indexes > 2000 || columns > 10000) invalid('максимум 2000 индексов и 10000 столбцов.');
    this.byName = new Map(this.tables.map(t => [JSON.stringify([t.schema, t.name]), t]));
    if (this.byName.size !== this.tables.length) invalid('повторяющаяся таблица.');
    const indexNames=this.tables.flatMap(t=>t.indexes.map(i=>JSON.stringify([t.schema,i.name])));
    if(new Set(indexNames).size!==indexNames.length)invalid('повторяющееся имя индекса в одной схеме.');
    if (!this.tables.length) invalid('не найдено ни одной таблицы.');
    if (new TextEncoder().encode(JSON.stringify(this.toJSON())).length > 512 * 1024) invalid('максимальный размер — 512 КБ.');
  }
  toJSON() { return { version: this.version, pgVersion: this.pgVersion, defaultSchema: this.defaultSchema, tables: this.tables }; }
  lookup(sqlName, allowUnqualified = true) {
    const p = parts(sqlName);
    if (p.length === 1 && allowUnqualified) p.unshift(this.defaultSchema);
    return p.length === 2 ? this.byName.get(JSON.stringify(p)) : undefined;
  }
  summary() { return { tables: this.tables.length, columns: this.tables.reduce((sum,t) => sum + t.columns.length, 0), indexes: this.tables.reduce((sum,t) => sum + t.indexes.length, 0), pgVersion: this.pgVersion, defaultSchema: this.defaultSchema }; }
  static from(input) { return input instanceof SchemaCatalog ? input : new SchemaCatalog(input); }
  static fromSQL(sql, { pgVersion = 17, defaultSchema = 'public' } = {}) {
    if (typeof sql !== 'string' || new TextEncoder().encode(sql).length > 512 * 1024) invalid('SQL должен быть текстом размером до 512 КБ.');
    const result = { version: 1, pgVersion, defaultSchema, tables: [] }, tables = new Map();
    const key = relation => JSON.stringify([relation.schemaname || defaultSchema, relation.relname]);
    const find = relation => { const t = tables.get(key(relation)); if (!t) invalid('сначала укажите CREATE TABLE для ' + relation.relname); return t; };
    const addConstraint = (t, c, column) => {
      if (c.contype === 'CONSTR_NOTNULL' && column) column.notNull = true;
      if (c.contype === 'CONSTR_CHECK') {
        const col = notNullColumn(c.raw_expr);
        if (col && c.conname) t.checks.push({ name: c.conname, column: col, validated: !!c.is_enforced && !c.skip_validation, enforced:!!c.is_enforced });
      }
      if (['CONSTR_PRIMARY', 'CONSTR_UNIQUE'].includes(c.contype)) {
        const cols = column ? [column.name] : strings(c.keys);
        if (!cols.length) invalid('ограничение USING INDEX требует явного описания индекса.');
        const indexName=c.conname || [t.name,...(c.contype==='CONSTR_PRIMARY'?[]:cols),c.contype==='CONSTR_PRIMARY'?'pkey':'key'].join('_');
        if(new TextEncoder().encode(indexName).length>63)invalid('задайте явное короткое имя PRIMARY KEY или UNIQUE.');
        t.indexes.push({ name: indexName, columns: cols, valid: true });
        if (c.contype === 'CONSTR_PRIMARY') for (const col of t.columns) if (cols.includes(col.name)) col.notNull = true;
      }
      if (!['CONSTR_NOTNULL', 'CONSTR_NULL', 'CONSTR_DEFAULT', 'CONSTR_CHECK', 'CONSTR_PRIMARY', 'CONSTR_UNIQUE', 'CONSTR_FOREIGN', 'CONSTR_IDENTITY', 'CONSTR_GENERATED'].includes(c.contype)) invalid('неподдерживаемое ограничение ' + c.contype);
    };
    const parsed = pg.parseSync(sql);
    if (parsed.stmts.length > 5000) invalid('не более 5000 команд.');
    for (const entry of parsed.stmts) {
      const [kind, node] = Object.entries(entry.stmt)[0];
      if (kind === 'CreateSchemaStmt' && !node.schemaElts?.length) continue;
      if (kind === 'CreateStmt') {
        if (tables.has(key(node.relation))) invalid('повторяющийся CREATE TABLE.');
        if (node.inhRelations?.length || node.partbound || node.partspec) invalid('наследование и секции требуют отдельного описания в JSON.');
        const t = { schema: node.relation.schemaname || defaultSchema, name: node.relation.relname, columns: [], indexes: [], checks: [] };
        tables.set(key(node.relation), t); result.tables.push(t);
        for (const e of node.tableElts || []) if (e.ColumnDef) t.columns.push({ name: e.ColumnDef.colname, notNull: false });
        for (const e of node.tableElts || []) {
          if (e.ColumnDef) { const col = t.columns.find(c => c.name === e.ColumnDef.colname); for (const c of e.ColumnDef.constraints || []) addConstraint(t, c.Constraint, col); }
          else if (e.Constraint) addConstraint(t, e.Constraint);
          else invalid('неподдерживаемое определение таблицы.');
        }
      } else if (kind === 'IndexStmt') {
        const t = find(node.relation);
        if (!node.idxname) invalid('задайте имя индекса.');
        const expressions = (node.indexParams || []).some(p => !p.IndexElem.name);
        t.indexes.push({ name: node.idxname, columns: (node.indexParams || []).filter(p => p.IndexElem.name).map(p => p.IndexElem.name), method: node.accessMethod || 'btree', partial: !!node.whereClause, expression: expressions, customSemantics:(node.indexParams || []).some(p => p.IndexElem.collation?.length || p.IndexElem.opclass?.length), valid: true });
      } else if (kind === 'AlterTableStmt') {
        const t = find(node.relation);
        for (const item of node.cmds) {
          const cmd = item.AlterTableCmd;
          if (cmd.subtype === 'AT_AddConstraint') addConstraint(t, cmd.def.Constraint);
          else if (cmd.subtype === 'AT_SetNotNull') { const col=t.columns.find(c=>c.name===cmd.name); if(!col) invalid('неизвестный столбец.'); col.notNull=true; }
          else if (cmd.subtype === 'AT_ValidateConstraint') { const c=t.checks.find(c=>c.name===cmd.name); if(c){if(!c.enforced)invalid('сначала включите исполнение CHECK.');c.validated=true;} }
          else if (cmd.subtype === 'AT_ChangeOwner') continue;
          else invalid('в снимке не поддерживается ALTER TABLE ' + cmd.subtype);
        }
      } else if (['CommentStmt', 'GrantStmt', 'AlterOwnerStmt'].includes(kind)) continue;
      else if (kind === 'VariableSetStmt' && node.name !== 'search_path') continue;
      else invalid('команда ' + kind + ' не является поддерживаемым описанием схемы. Строки данных, функции и команды search_path не принимаются.');
    }
    return new SchemaCatalog(result);
  }
}
SchemaCatalog.quote = quote;
module.exports = SchemaCatalog;
