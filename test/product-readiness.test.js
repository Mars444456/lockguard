require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {RuleEngine,AutoSplitter,PgParser,SchemaCatalog,PostDeployWatchdog,ContextAnalyzer,ShadowReplaySimulator}=require('../src/core');
const {createBot}=require('../bin/bot');
const engine=new RuleEngine();
const analyze=sql=>engine.analyze(sql),plan=sql=>AutoSplitter.generatePlan(analyze(sql));
const sqlOf=p=>p.phases.map(p=>p.sql).join('\n');

test('Index rewriting survives comments and UTF-8 without changing expressions or predicates',()=>{
  const sql='CREATE /* Индекс */ UNIQUE INDEX "Мой индекс" ON "Таблица" ((lower(email))) INCLUDE (id) WHERE email IS NOT NULL;';
  const p=plan(sql),index=PgParser.parse(p.phases[0].sql).find(s=>s.type==='CREATE_INDEX');
  assert.equal(index.isConcurrent,true);assert.equal(index.isUnique,true);assert.equal(index.isPartial,true);
  assert.match(sqlOf(p),/lower\(email\)/);assert.match(sqlOf(p),/INCLUDE \(id\)/);
});

test('Unique plans execute and preserve NULLS NOT DISTINCT, INCLUDE and deferred constraints',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE users(email text, payload int); INSERT INTO users VALUES(NULL,1)');
    const p=plan('ALTER TABLE users ADD CONSTRAINT "Unique Name" UNIQUE NULLS NOT DISTINCT(email) INCLUDE(payload) DEFERRABLE INITIALLY DEFERRED;');
    for(const phase of p.phases)for(const stmt of PgParser.parse(phase.sql))await db.exec(stmt.raw);
    const rows=(await db.query("SELECT condeferrable,condeferred FROM pg_constraint WHERE conname='Unique Name'")).rows;
    assert.equal(rows[0].condeferrable,true);assert.equal(rows[0].condeferred,true);
    await assert.rejects(db.exec('INSERT INTO users VALUES(NULL,2)'),/duplicate key/);
  }finally{await db.close();}
});

test('Multi-action FK plans preserve the exact clause, not a neighboring action or comment',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE parent(id int PRIMARY KEY); CREATE TABLE child(id int,pid int)');
    const p=plan('/* Юникод */ ALTER /* x */ TABLE child ADD COLUMN note text, ADD CONSTRAINT "Связь" FOREIGN KEY(pid) REFERENCES parent(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED /* tail */;');
    const fk=p.phases[0].sql;assert.match(fk,/NOT VALID/);assert.doesNotMatch(fk,/ADD COLUMN note/);
    for(const phase of p.phases)for(const stmt of PgParser.parse(phase.sql))await db.exec(stmt.raw);
    const row=(await db.query("SELECT confdeltype,condeferrable,condeferred,convalidated FROM pg_constraint WHERE conname='Связь'")).rows[0];
    assert.deepEqual(row,{confdeltype:'c',condeferrable:true,condeferred:true,convalidated:true});
  }finally{await db.close();}
});

test('Materialized-view refresh never becomes DELETE; destructive plans invent no columns or loops',()=>{
  assert.match(sqlOf(plan('REFRESH MATERIALIZED VIEW "Sales Report";')),/REFRESH MATERIALIZED VIEW CONCURRENTLY "Sales Report"/);
  assert.doesNotMatch(sqlOf(plan('REFRESH MATERIALIZED VIEW "Sales Report";')),/DELETE/);
  for(const sql of ['DROP TABLE "Customer Data";','ALTER TABLE customers DROP COLUMN old;','TRUNCATE orders RESTART IDENTITY CASCADE;','REFRESH MATERIALIZED VIEW report WITH NO DATA;']){
    const p=plan(sql);assert.equal(p.phases.length,0);assert.ok(p.manualSteps.length);assert.doesNotMatch(sqlOf(p),/DELETE|col_to_drop|old_column/);
  }
});

test('Target version, unknown function volatility and transaction boundaries affect actual verdicts',()=>{
  const schema=SchemaCatalog.fromSQL('CREATE TABLE orders(id int);',{pgVersion:10});
  assert.equal(engine.analyze("SET lock_timeout='3s'; ALTER TABLE orders ADD COLUMN ts timestamp DEFAULT now();",{schema}).passed,false);
  const unknown=analyze('ALTER TABLE orders ADD COLUMN n int DEFAULT my_stable_function();').violations.find(v=>v.ruleId==='LG-001');
  assert.equal(unknown.isPhysicalTableRewrite,null);assert.match(unknown.message,/cannot be established/);
  for(const end of ['COMMIT','ROLLBACK','END'])assert.equal(analyze(`BEGIN; SELECT 1; ${end}; CREATE INDEX CONCURRENTLY ix ON t(id);`).violations.some(v=>v.ruleId==='LG-010'),false);
  assert.ok(analyze('START TRANSACTION READ WRITE; CREATE INDEX CONCURRENTLY ix ON t(id); COMMIT;').violations.some(v=>v.ruleId==='LG-010'));
  assert.ok(analyze('BEGIN; COMMIT AND CHAIN; CREATE INDEX CONCURRENTLY ix ON t(id); ROLLBACK;').violations.some(v=>v.ruleId==='LG-010'));
  assert.equal(engine.analyze('ALTER TABLE t ADD CONSTRAINT uq UNIQUE NULLS NOT DISTINCT(id);',{pgVersion:14}).analysisComplete,false);
});

test('Suppressions apply to statement offsets and are visible; partial analyses cannot generate drafts',()=>{
  assert.throws(()=>analyze('-- comment only'),/No SQL statements/);
  assert.throws(()=>analyze('SELECT 1;'.repeat(1001)),/1000 SQL/);
  const r=analyze('/* lockguard-ignore-all */ CREATE INDEX a ON t(id); CREATE INDEX b ON t(id);');
  assert.deepEqual(r.violations.filter(v=>v.ruleId==='LG-002').map(v=>v.indexName),['b']);
  assert.equal(r.coverageComplete,false);assert.ok(r.coverage.suppressedFindings.length);
  assert.throws(()=>AutoSplitter.generatePlan(r),/incomplete/);
  assert.throws(()=>engine.analyze('SELECT 1',{enabledRuleIds:[]}),/At least one/);
  assert.throws(()=>engine.analyze('SELECT 1',{ignoreRules:['LG-999']}),/known rule IDs/);
});

test('Monitoring fails without evidence, rejects malformed rows and never guesses destructive repair SQL',()=>{
  assert.throws(()=>PostDeployWatchdog.evaluate(),/diagnostic rows/);
  for(const rows of [{},[{}],[{index_name:'i',table_name:'t',is_valid:'maybe'}]])assert.throws(()=>PostDeployWatchdog.evaluate(rows));
  const report=PostDeployWatchdog.inspectProduction([{schema_name:'Weird,Schema',index_name:'a"b',table_name:'t',is_valid:'f',index_kind:'i'}]);
  assert.equal(report.totalInvalidCount,1);assert.equal(report.source,'provided_telemetry');assert.equal(report.measured,false);
  assert.match(report.invalidIndexes[0].safeFix,/"Weird,Schema"\."a""b"/);assert.doesNotMatch(report.invalidIndexes[0].safeFix,/DROP INDEX/);
  assert.doesNotMatch(PostDeployWatchdog.inspectProduction([]).message,/100%|production.*healthy/i);
});

test('Metadata has no invented table sizes or execution-time predictions',()=>{
  const a=analyze('CREATE INDEX ix ON orders(id);'),r=ContextAnalyzer.enrich(a,{demoMode:true});
  assert.equal(r.hasTableMetrics,false);assert.equal(r.maxEstimatedDowntimeSec,null);assert.equal(r.violations[0].tableStats,null);
  assert.throws(()=>ContextAnalyzer.enrich(a,{tables:{orders:{rowCount:-1}}}),/non-negative/);
  assert.throws(()=>ShadowReplaySimulator.simulate(a),error=>error.statusCode===410);
});

test('Bot does not activate Pro via old callbacks, sends bounded plain-text reports and limits uploads',async()=>{
  const calls=[];let downloaded=false;
  const bot=createBot({transport:async(method,data)=>{calls.push({method,data});return {};},download:async()=>{downloaded=true;return Buffer.from('SELECT 1');}});
  await bot.handleUpdate({callback_query:{id:'test',data:'claim_pro_key',message:{chat:{id:1,type:'private'}}}});
  let messages=calls.filter(c=>c.method==='sendMessage');
  assert.match(messages[0].data.text,/не подтверждает оплату/);assert.doesNotMatch(messages[0].data.text,/LG-PRO|активирована/);
  calls.length=0;
  await bot.handleUpdate({message:{chat:{id:1,type:'private'},text:Array.from({length:30},(_,i)=>`CREATE INDEX ix${i} ON t(id);`).join('\n')}});
  messages=calls.filter(c=>c.method==='sendMessage');assert.ok(messages.length>1);
  assert.ok(messages.every(c=>c.data.text.length<=4096&&!c.data.parse_mode));assert.match(messages.map(c=>c.data.text).join(''),/LG-002/);
  await bot.handleUpdate({message:{chat:{id:1,type:'private'},document:{file_name:'a.sql',file_size:600000,file_id:'x'}}});
  assert.equal(downloaded,false);
  calls.length=0;await bot.handleUpdate({message:{chat:{id:2,type:'group'},text:'CREATE INDEX x ON t(id);'}});assert.equal(calls.length,0);
});
