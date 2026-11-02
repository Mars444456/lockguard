// Table metadata provides context, not a calibrated execution-time forecast.
class ContextAnalyzer {
  static validateStats(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Table statistics must be an object keyed by SQL table name.');
    const result=Object.create(null);
    for(const [table,stats] of Object.entries(input)){
      if(!stats||typeof stats!=='object'||Array.isArray(stats))throw new TypeError('Invalid table statistics.');
      const rowCount=stats.rowCount??stats.row_count??stats.rows??null,sizeMb=stats.sizeMb??stats.size_mb??stats.size??null;
      if([rowCount,sizeMb].some(n=>n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0)))throw new TypeError('Statistics must be non-negative numbers or null (unknown).');
      result[table]={rowCount,sizeMb};
    }
    return result;
  }
  static enrich(analysis,dbContext={}){
    const tables=this.validateStats(dbContext.tables||{});
    const hasStats=analysis.affectedTables.some(table=>Object.hasOwn(tables,table));
    return {...analysis,measured:false,hasTableMetrics:hasStats,hasLiveContext:hasStats&&dbContext.source==='database',
      metricsSource:hasStats?(dbContext.source==='database'?'database':'provided'):'unavailable',
      maxEstimatedDowntimeSec:null,maxEstimatedDowntimeFormatted:'Not measured',
      contextSummary:hasStats?'Supplied table metadata only. Row counts may be estimates. Execution time and lock waits have not been measured.':'No table metadata was supplied. SQL was not executed; duration and lock waiting are unknown.',
      violations:analysis.violations.map(v=>({...v,tableStats:Object.hasOwn(tables,v.table)?tables[v.table]:null,
        estimatedLockDurationSec:null,estimatedDowntimeFormatted:null,downtimeRiskLevel:'UNKNOWN',
        contextualMessage:`${v.table}: ${Object.hasOwn(tables,v.table)?'supplied table metadata attached':'table metrics unavailable'}. Execution time and lock waiting require measurement on a representative database.`}))};
  }
  static fetchSchemaStats(options={}){
    if(options.schemaStatsPath)return this.validateStats(JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(options.schemaStatsPath),'utf8')));
    if(!options.useLiveDb)return {};
    const dbUrl=options.databaseUrl||process.env.DATABASE_URL;
    if(!dbUrl)throw new Error('Set DATABASE_URL or provide --schema-stats; metadata was not retrieved.');
    try{
      const sql=`SELECT COALESCE(json_object_agg(table_name,json_build_object('rowCount',row_count,'sizeMb',size_mb)),'{}'::json) FROM (
        SELECT CASE WHEN n.nspname='public' THEN quote_ident(c.relname) ELSE format('%I.%I',n.nspname,c.relname) END AS table_name,
        CASE WHEN c.reltuples<0 THEN NULL ELSE c.reltuples::bigint END AS row_count,
        pg_total_relation_size(c.oid)::numeric/(1024*1024) AS size_mb
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','m') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%') s`;
      const raw=require('node:child_process').execFileSync('psql',['-X','-w','--set=ON_ERROR_STOP=1','-d',dbUrl,'-t','-A','-c',sql],{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']});
      return this.validateStats(JSON.parse(raw));
    }catch{throw new Error('Table metadata was not retrieved: psql connection, query or JSON decoding failed.');}
  }
}
module.exports=ContextAnalyzer;
