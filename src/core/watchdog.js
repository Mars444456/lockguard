const {execFileSync}=require('node:child_process');

function invalid(message){throw Object.assign(new TypeError(message),{statusCode:400});}
function boolean(value){
  if([true,'t','true'].includes(value))return true;
  if([false,'f','false'].includes(value))return false;
  invalid('Each diagnostic row must include a PostgreSQL boolean is_valid.');
}
function name(value){if(typeof value!=='string'||!value||value.includes('\0')||Buffer.byteLength(value)>256)invalid('Each diagnostic row must include an index_name and table_name.');return value;}
const quote=value=>'"'+value.replaceAll('"','""')+'"';

class PostDeployWatchdog {
  static getDiagnosticQuery(){
    return `SELECT ns.nspname AS schema_name, ic.relname AS index_name, tbl.relname AS table_name,
      idx.indisvalid AS is_valid, idx.indisready AS is_ready, idx.indislive AS is_live,
      ic.relkind AS index_kind, pg_size_pretty(pg_relation_size(idx.indexrelid)) AS index_size
      FROM pg_index idx JOIN pg_class ic ON ic.oid=idx.indexrelid
      JOIN pg_namespace ns ON ns.oid=ic.relnamespace JOIN pg_class tbl ON tbl.oid=idx.indrelid
      WHERE NOT idx.indisvalid`;
  }
  static evaluate(queryRows, {source='provided_telemetry'}={}){
    if(!Array.isArray(queryRows)||queryRows.length>10000)invalid('Expected up to 10000 actual diagnostic rows, not an omitted or invalid report.');
    const invalidIndexes=[];
    for(const row of queryRows){
      if(!row||typeof row!=='object'||Array.isArray(row))invalid('Invalid diagnostic row.');
      const indexName=name(row.index_name),tableName=name(row.table_name),valid=boolean(row.is_valid??row.indisvalid);
      const schema=row.schema_name===undefined?null:name(row.schema_name);
      if(row.is_ready!==undefined)boolean(row.is_ready);
      if(row.is_live!==undefined)boolean(row.is_live);
      if(valid)continue;
      const qualified=schema ? quote(schema)+'.'+quote(indexName) : null;
      const canSuggestReindex=qualified && row.index_kind==='i' && boolean(row.is_live??true);
      invalidIndexes.push({indexName,tableName,schemaName:schema,size:typeof row.index_size==='string'?row.index_size:null,
        hazard:'INVALID_INDEX',impact:'The catalog marks this index invalid. Its cause and effect on writes require inspection; this report does not prove a failed concurrent build.',
        safeFix:canSuggestReindex ? `-- Review PostgreSQL version, privileges, active builds, dependencies and available disk space first.\n-- Run as a separate statement outside a transaction block (PostgreSQL 12+).\nREINDEX INDEX CONCURRENTLY ${qualified};`
          : '-- Inspect the qualified index, active builds and dependencies in the target database before choosing a repair. No DROP is generated.'});
    }
    return {healthy:invalidIndexes.length===0,totalInvalidCount:invalidIndexes.length,invalidIndexes,source,
      scope:'invalid_indexes_in_supplied_diagnostic_result',measured:source==='database_query',checkedAt:new Date().toISOString()};
  }
  static inspectProduction(queryRows){
    let source='provided_telemetry';
    if(queryRows===undefined){
      if(!process.env.DATABASE_URL)throw new Error('Index inspection was not performed. Set DATABASE_URL with psql installed, or supply diagnostic JSON rows.');
      try{
        const sql=`SELECT COALESCE(json_agg(lg_rows),'[]'::json) FROM (${this.getDiagnosticQuery()}) AS lg_rows`;
        const raw=execFileSync('psql',['-X','-w','--set=ON_ERROR_STOP=1','-d',process.env.DATABASE_URL,'-t','-A','-c',sql],
          {encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']});
        queryRows=JSON.parse(raw);source='database_query';
      }catch{throw new Error('Index inspection was not completed: psql connection, query or JSON decoding failed.');}
    }
    const result=this.evaluate(queryRows,{source});
    return {...result,hasBrokenIndexes:result.totalInvalidCount>0,message:result.totalInvalidCount
      ? `Detected ${result.totalInvalidCount} INVALID index(es) in the diagnostic result.\n`+result.invalidIndexes.map(i=>`${i.schemaName?i.schemaName+'.':''}${i.indexName} on ${i.tableName}\n${i.impact}\n${i.safeFix}`).join('\n\n')
      : 'No invalid indexes were reported in this diagnostic result. This does not establish overall database health.'};
  }
}
module.exports=PostDeployWatchdog;
