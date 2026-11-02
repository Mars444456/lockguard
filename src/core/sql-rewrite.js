const pg=require('libpg-query');
const {generatedName}=require('./sql-identifiers');
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
const bytes=value=>new TextEncoder().encode(value);
const decode=value=>new TextDecoder().decode(value);
const tokens=sql=>pg.scanSync(sql).tokens.filter(t=>!['SQL_COMMENT','C_COMMENT'].includes(t.tokenName));

function concurrentIndex(raw) {
  if(typeof raw!=='string')return null;
  const parsed=pg.parseSync(raw);if(parsed.stmts.length!==1||!parsed.stmts[0].stmt.IndexStmt)return null;
  if(parsed.stmts[0].stmt.IndexStmt.concurrent)return raw.replace(/;\s*$/,'')+';';
  const token=tokens(raw).find(t=>t.text.toUpperCase()==='INDEX');if(!token)return null;
  const input=bytes(raw),sql=decode(input.slice(0,token.end))+' CONCURRENTLY'+decode(input.slice(token.end));
  if(!pg.parseSync(sql).stmts[0]?.stmt.IndexStmt?.concurrent)return null;
  return sql.replace(/;\s*$/,'')+';';
}
function foreignKey(raw,table) {
  if(typeof raw!=='string')return null;
  const candidate=(/^ALTER\b/i.test(raw)?raw:`ALTER TABLE ${table} ${raw}`).replace(/;\s*$/,'');
  try {
    const stmts=pg.parseSync(candidate).stmts,node=stmts[0]?.stmt.AlterTableStmt;
    if(stmts.length!==1||node?.cmds.length!==1||node.cmds[0].AlterTableCmd.def?.Constraint?.contype!=='CONSTR_FOREIGN')return null;
    const sql=candidate+'\nNOT VALID;';if(!pg.parseSync(sql).stmts[0].stmt.AlterTableStmt.cmds[0].AlterTableCmd.def.Constraint.skip_validation)return null;
    return sql;
  }catch{return null;}
}
function alterActions(raw,relationLocation,sourceStart) {
  const stream=tokens(raw),relative=relationLocation-sourceStart;
  let i=stream.findIndex(t=>t.start===relative);if(i<0)return [];
  i++;while(stream[i]?.text==='.'&&stream[i+1])i+=2;if(stream[i]?.text==='*')i++;
  if(!stream[i])return [];
  let start=stream[i].start,depth=0;const parts=[],input=bytes(raw);
  for(;i<stream.length;i++) {
    const t=stream[i];if(['(','['].includes(t.text))depth++;if([')',']'].includes(t.text))depth--;
    if(t.text===','&&depth===0){parts.push(decode(input.slice(start,t.start)).trim());start=t.end;}
  }
  parts.push(decode(input.slice(start)).trim());return parts;
}
function unique(v) {
  if(!v.columns?.length||v.uniqueOptionsUnsupported)return null;
  const constraint=v.constraintName||generatedName('uq',v.table,...v.columns),index=generatedName(constraint,'idx');
  const include=v.including?.length?` INCLUDE (${v.including.join(', ')})`:'';
  const create=`CREATE UNIQUE INDEX CONCURRENTLY ${index} ON ${v.table} (${v.columns.join(', ')})${include}${v.nullsNotDistinct?' NULLS NOT DISTINCT':''}${v.tablespace?' TABLESPACE '+quote(v.tablespace):''};`;
  const attach=`ALTER TABLE ${v.table} ADD CONSTRAINT ${constraint} UNIQUE USING INDEX ${index}${v.deferrable?' DEFERRABLE'+(v.initiallyDeferred?' INITIALLY DEFERRED':' INITIALLY IMMEDIATE'):''};`;
  pg.parseSync(create);pg.parseSync(attach);return {create,attach};
}
module.exports={concurrentIndex,foreignKey,alterActions,unique};
