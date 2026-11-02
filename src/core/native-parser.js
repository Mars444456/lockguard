const pg = require('libpg-query');
const columnTypes = require('./column-types');
const rewrite = require('./sql-rewrite');
let ready = false;
const initialization = pg.loadModule().then(() => { ready = true; });
const strings = values => (values || []).map(v => v.String.sval);
const ident = name => /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
const relation = value => [value?.schemaname, value?.relname].filter(Boolean).map(ident).join('.');
function walk(value, callback) {
  if (!value || typeof value !== 'object') return;
  callback(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(v => walk(v, callback));
    else walk(child, callback);
  }
}
function typeName(type) {
  if (!type) return 'TEXT';
  const names = strings(type.names);
  if (names[0] === 'pg_catalog') names.shift();
  const builtins = { int4: 'INTEGER', int8: 'BIGINT', int2: 'SMALLINT', bool: 'BOOLEAN', varchar: 'VARCHAR', timestamp: 'TIMESTAMP', timestamptz: 'TIMESTAMPTZ', text: 'TEXT', uuid: 'UUID', numeric: 'NUMERIC' };
  const base = names.length === 1 && builtins[names[0]] ? builtins[names[0]] : names.map(ident).join('.');
  const mods = (type.typmods || []).map(m => m.A_Const?.ival?.ival ?? m.A_Const?.sval?.sval);
  return base + (mods.length ? `(${mods.join(', ')})` : '') + (type.arrayBounds?.length ? '[]'.repeat(type.arrayBounds.length) : '');
}
function expressionVolatility(expr) {
  let volatility = 'nonvolatile';
  walk(expr, node => {
    if (node.FuncCall) {
      const name = strings(node.FuncCall.funcname).join('.');
      const bare = name.replace(/^pg_catalog\./, '');
      if (['random','gen_random_uuid','clock_timestamp','nextval','setval'].includes(bare)) volatility = 'volatile';
      else if (!['now','statement_timestamp','transaction_timestamp'].includes(bare) && volatility !== 'volatile') volatility = 'unknown';
    }
    if (node.SubLink && volatility !== 'volatile') volatility = 'unknown';
    if (node.NextValueExpr) volatility = 'volatile';
    if ((node.TypeCast || node.A_Expr || node.CollateClause) && volatility !== 'volatile') volatility = 'unknown';
  });
  return volatility;
}

module.exports = {
  initialize: () => initialization,
  parse(sql, legacy) {
    if (!ready) throw new Error('PostgreSQL parser is loading. Await PgParser.initialize() before synchronous analysis.');
    let parsed;
    try { parsed = pg.parseSync(sql); }
    catch (cause) { throw new SyntaxError(`Invalid or incomplete PostgreSQL SQL: ${cause.message}`, { cause }); }
    const bytes = new TextEncoder().encode(sql);
    const decode = (start, end) => new TextDecoder().decode(bytes.slice(start, end));
    let previousEnd = 0;
    return parsed.stmts.map((entry,statementIndex) => {
      const nativeStart = entry.stmt_location || 0;
      const start = previousEnd;
      const end = entry.stmt_len ? nativeStart + entry.stmt_len : bytes.length;
      previousEnd = end + (bytes[end] === 59 ? 1 : 0);
      const rawFull = decode(start, end);
      const tokens = pg.scanSync(rawFull).tokens;
      const comments = tokens.filter(t => ['SQL_COMMENT', 'C_COMMENT'].includes(t.tokenName));
      const first = tokens.find(t => !comments.includes(t));
      const localBytes = new TextEncoder().encode(rawFull);
      const raw = new TextDecoder().decode(localBytes.slice(first?.start || 0)).replace(/;\s*$/, '');
      const line = decode(0, start + (first?.start || 0)).split('\n').length;
      const directiveComments = comments.map(c => c.tokenName === 'SQL_COMMENT' && !c.text.startsWith('--') ? '--' + c.text : c.text);
      const directives = legacy.extractIgnoreDirectives(directiveComments);
      const stmt = legacy.parseStatement(raw, line, rawFull, comments.map(c => c.text), directives);
      const [kind, node] = Object.entries(entry.stmt)[0];
      Object.assign(stmt, { pgKind: kind, pgAst: node, parserVersion: parsed.version,
        statementIndex,sourceStart: start + (first?.start || 0), sourceEnd: end });
      if (['SelectStmt', 'InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt'].includes(kind)) {
        walk(node, n => { if (n.FuncCall) stmt.requiresManualAnalysis = true; });
      }
      if (node.relation) stmt.table = relation(node.relation);
      if (kind === 'TransactionStmt') {
        stmt.type = ['TRANS_STMT_BEGIN','TRANS_STMT_START'].includes(node.kind) ? 'TRANSACTION_START'
          : ['TRANS_STMT_COMMIT','TRANS_STMT_ROLLBACK'].includes(node.kind) ? 'TRANSACTION_COMMIT' : stmt.type;
        if(tokens.some(token=>!comments.includes(token)&&token.text.toUpperCase()==='CHAIN'))stmt.requiredPgVersion=12;
      } else if (kind === 'CreateStmt') {
        stmt.type = 'CREATE_TABLE'; stmt.ifNotExists = !!node.if_not_exists;
        walk(node, n => { if (n.Constraint?.contype === 'CONSTR_FOREIGN') stmt.requiresManualAnalysis = true; });
      } else if (kind === 'IndexStmt') {
        if(node.relation && !node.relation.inh)stmt.requiresManualAnalysis=true;
        if(node.nulls_not_distinct)stmt.requiredPgVersion=15;
        Object.assign(stmt, { type: 'CREATE_INDEX', indexName: node.idxname ? ident(node.idxname) : stmt.indexName,
          isUnique: !!node.unique, isConcurrent: !!node.concurrent, isPartial: !!node.whereClause,
          accessMethod: node.accessMethod, columns: (node.indexParams || []).map(p => p.IndexElem.name ? ident(p.IndexElem.name) : '(expression)') });
      } else if (kind === 'AlterTableStmt') {
        // Protobuf JSON omits false booleans: ONLY has no `inh` property.
        if(node.relation && !node.relation.inh)stmt.requiresManualAnalysis=true;
        const previous = stmt.subcommands || [];
        const actions=rewrite.alterActions(raw,node.relation.location,stmt.sourceStart);
        stmt.type = 'ALTER_TABLE';
        stmt.subcommands = node.cmds.map((wrapped, i) => {
          const cmd = wrapped.AlterTableCmd;
          const sub = { ...previous[i], table: stmt.table, line, raw:actions.length===node.cmds.length?actions[i]:previous[i]?.raw||raw };
          const mapping = { AT_ColumnDefault: 'ALTER_COLUMN_DEFAULT', AT_SetNotNull: 'SET_NOT_NULL', AT_DropNotNull: 'DROP_NOT_NULL', AT_AlterColumnType: 'ALTER_COLUMN_TYPE', AT_DropColumn: 'DROP_COLUMN', AT_DropConstraint: 'DROP_CONSTRAINT', AT_ValidateConstraint: 'VALIDATE_CONSTRAINT', AT_SetRelOptions: 'SET_STORAGE_PARAM' };
          sub.subtype = mapping[cmd.subtype] || 'UNSUPPORTED';
          if (cmd.name) sub.column = ident(cmd.name);
          if (cmd.subtype === 'AT_AddColumn') {
            if(cmd.missing_ok)stmt.requiresManualAnalysis=true;
            const col = cmd.def.ColumnDef;
            const constraints = (col.constraints || []).map(c => c.Constraint);
            const def = constraints.find(c => c.contype === 'CONSTR_DEFAULT');
            Object.assign(sub, { subtype: 'ADD_COLUMN', column: ident(col.colname), dataType: typeName(col.typeName), hasDefault: !!def,
              defaultVolatility: def ? expressionVolatility(def.raw_expr) : 'nonvolatile',
              collation: col.collClause ? strings(col.collClause.collname).map(ident).join('.') : null,
              isNotNull: constraints.some(c => c.contype === 'CONSTR_NOTNULL'), isTrulyVolatile: def ? expressionVolatility(def.raw_expr) === 'volatile' : false });
            const typeParts=strings(col.typeName.names);
            if(typeParts[0]!=='pg_catalog' && !(typeParts.length===1&&['text','uuid','json','jsonb','bytea','date','time','timetz','interval','inet','cidr','macaddr','xml','timestamptz','timestamp','varchar','bpchar','bool','int2','int4','int8','float4','float8','numeric'].includes(typeParts[0])))stmt.requiresManualAnalysis=true;
            if(def && typeParts[0]!=='pg_catalog' && !(typeParts.length===1&&['text','uuid','json','jsonb','bytea','date','time','timetz','interval','inet','cidr','macaddr','xml','timestamptz','timestamp','varchar','bpchar','bool','int2','int4','int8','float4','float8','numeric'].includes(typeParts[0])) && sub.defaultVolatility!=='volatile')sub.defaultVolatility='unknown';
            sub.isVolatileDefault = !!def && (sub.isTrulyVolatile || !!sub.isVolatileDefault);
            sub.isPhysicalTableRewrite = sub.isTrulyVolatile;
            if (def) {
              const afterDefault = decode(def.location + 7, end);
              const expressionTokens = pg.scanSync(afterDefault).tokens;
              let depth = 0;
              const nextConstraint = constraints.filter(c => c.location > def.location).map(c => c.location - def.location - 7);
              let stop = nextConstraint.length ? Math.min(...nextConstraint) : new TextEncoder().encode(afterDefault).length;
              for (const token of expressionTokens) {
                if (token.text === '(' || token.text === '[') depth++;
                if (token.text === ')' || token.text === ']') depth--;
                if (token.text === ',' && depth === 0) { stop = Math.min(stop, token.start); break; }
              }
              sub.defaultValue = new TextDecoder().decode(new TextEncoder().encode(afterDefault).slice(0, stop)).trim().replace(/;$/, '');
            }
            if (constraints.some(c => !['CONSTR_DEFAULT', 'CONSTR_NOTNULL', 'CONSTR_NULL'].includes(c.contype))) sub.subtype = 'UNSUPPORTED';
          } else if (cmd.subtype === 'AT_AddConstraint') {
            const c = cmd.def.Constraint;
            sub.subtype = ({ CONSTR_FOREIGN: 'ADD_FOREIGN_KEY', CONSTR_UNIQUE: 'ADD_UNIQUE_CONSTRAINT', CONSTR_CHECK: 'ADD_CHECK_CONSTRAINT' })[c.contype] || 'UNSUPPORTED';
            Object.assign(sub, { constraintName: c.conname ? ident(c.conname) : null,
              columns: strings(c.fk_attrs || c.keys).map(ident), foreignTable: c.pktable ? relation(c.pktable) : undefined,
              foreignColumns: strings(c.pk_attrs).map(ident), isNotValid: !!c.skip_validation,
              usingIndex: c.indexname ? ident(c.indexname) : null, isUsingIndex: !!c.indexname });
            Object.assign(sub,{nullsNotDistinct:!!c.nulls_not_distinct,deferrable:!!c.deferrable,initiallyDeferred:!!c.initdeferred,
              including:strings(c.including).map(ident),tablespace:c.indexspace,uniqueOptionsUnsupported:!!c.options?.length});
            if(c.nulls_not_distinct)stmt.requiredPgVersion=15;
            const check = c.raw_expr?.NullTest;
            if (c.contype === 'CONSTR_CHECK' && !c.skip_validation) stmt.requiresManualAnalysis = true;
            sub.validatedColumn = check?.nulltesttype === 'IS_NOT_NULL' && check.arg?.ColumnRef?.fields?.length === 1
              ? ident(check.arg.ColumnRef.fields[0].String.sval) : undefined;
          } else if (cmd.subtype === 'AT_AlterColumnType') {
            const column = cmd.def.ColumnDef;
            sub.newType = typeName(column.typeName);
            sub.targetType = columnTypes.fromAst(column.typeName);
            sub.hasUsing = !!column.raw_default;
            sub.hasCollation = !!column.collClause;
          }
          else if (['AT_ValidateConstraint', 'AT_DropConstraint'].includes(cmd.subtype)) sub.constraintName = ident(cmd.name);
          return sub;
        });
        stmt.actions = stmt.subcommands;
      } else if(kind==='DropStmt') {
        const names=(node.objects||[]).map(object=>strings(object.List?.items).map(ident).join('.'));
        if(node.removeType==='OBJECT_TABLE')Object.assign(stmt,{type:'DROP_TABLE',tables:names});
        else if(node.removeType==='OBJECT_INDEX')Object.assign(stmt,{type:'DROP_INDEX',indexes:names,isConcurrent:!!node.concurrent});
        else stmt.requiresManualAnalysis=true;
      } else if(kind==='TruncateStmt') {
        Object.assign(stmt,{type:'TRUNCATE_TABLE',tables:(node.relations||[]).map(r=>relation(r.RangeVar)),restartIdentity:!!node.restart_seqs,cascade:node.behavior==='DROP_CASCADE'});
      } else if(kind==='RefreshMatViewStmt') {
        Object.assign(stmt,{type:'REFRESH_MATVIEW',view:relation(node.relation),isConcurrent:!!node.concurrent,withNoData:!!node.skipData});
        if(node.concurrent&&node.skipData)stmt.requiresManualAnalysis=true;
      } else if(kind==='VacuumStmt') {
        stmt.type='VACUUM';stmt.isFull=(node.options||[]).some(o=>o.DefElem?.defname==='full');
      } else if (kind === 'VariableSetStmt') {
        const arg = node.args?.[0]?.A_Const;
        Object.assign(stmt, { type: ['VAR_RESET', 'VAR_RESET_ALL'].includes(node.kind) ? 'RESET_VARIABLE' : 'SET_VARIABLE',
          variable: node.name || 'all', value: arg?.sval?.sval ?? arg?.ival?.ival ?? null, isLocal: !!node.is_local });
      }
      return stmt;
    });
  }
};
