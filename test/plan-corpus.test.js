require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {RuleEngine,AutoSplitter,PgParser,SchemaCatalog}=require('../src/core');
const engine=new RuleEngine();
const execute=async(db,plan)=>{for(const phase of plan.phases)for(const statement of PgParser.parse(phase.sql))await db.exec(statement.raw);};

test('Index drafts retain key ordering, INCLUDE, storage parameters and the partial unique predicate',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE SCHEMA "Tenant.Space"; CREATE TABLE "Tenant.Space"."Event.Log"("Key" int,"Payload" text,"Deleted" boolean);');
    const sql='CREATE UNIQUE INDEX "Case.Index" ON "Tenant.Space"."Event.Log" USING btree ("Key" DESC NULLS FIRST) INCLUDE ("Payload") WITH (fillfactor=75) WHERE ("Deleted" = false);';
    const plan=AutoSplitter.generatePlan(engine.analyze(sql));
    await execute(db,plan);
    const {rows:[index]}=await db.query("SELECT i.indisunique,i.indisvalid,i.indnkeyatts,i.indnatts,i.indoption::text AS ordering,c.reloptions,pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='Case.Index'");
    assert.deepEqual(index,{indisunique:true,indisvalid:true,indnkeyatts:1,indnatts:2,ordering:'3',reloptions:['fillfactor=75'],predicate:'("Deleted" = false)'});
    await db.exec('INSERT INTO "Tenant.Space"."Event.Log" VALUES(1,\'first\',false),(1,\'excluded\',true);');
    await assert.rejects(db.exec('INSERT INTO "Tenant.Space"."Event.Log" VALUES(1,\'duplicate\',false)'),error=>error.code==='23505');
    assert.equal(plan.phases[0].mustRunOutsideTransaction,true);
  }finally{await db.close();}
});

test('Composite quoted FK drafts preserve MATCH FULL and referential actions in catalog and data behavior',async()=>{
  const db=new PGlite();
  const ddl='CREATE SCHEMA "Tenant.Space"; CREATE TABLE "Tenant.Space"."Parent Accounts"("Account ID" int,"Region ID" int,PRIMARY KEY("Account ID","Region ID")); CREATE TABLE "Tenant.Space"."Order.Items"("Account ID" int,"Region ID" int);';
  try{
    await db.exec(ddl);
    await db.exec('INSERT INTO "Tenant.Space"."Parent Accounts" VALUES(1,10); INSERT INTO "Tenant.Space"."Order.Items" VALUES(1,10);');
    const sql='ALTER TABLE "Tenant.Space"."Order.Items" ADD CONSTRAINT "Composite Link" FOREIGN KEY("Account ID","Region ID") REFERENCES "Tenant.Space"."Parent Accounts"("Account ID","Region ID") MATCH FULL ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;';
    const snapshot=SchemaCatalog.fromSQL(ddl),before=JSON.stringify(snapshot.toJSON());
    const plan=AutoSplitter.generatePlan(engine.analyze(sql,{schema:snapshot}));
    assert.equal(JSON.stringify(snapshot.toJSON()),before,'Draft analysis must not mutate the saved snapshot');
    await execute(db,plan);
    const {rows:[constraint]}=await db.query("SELECT confmatchtype,confupdtype,confdeltype,condeferrable,condeferred,convalidated FROM pg_constraint WHERE conname='Composite Link'");
    assert.deepEqual(constraint,{confmatchtype:'f',confupdtype:'c',confdeltype:'n',condeferrable:true,condeferred:true,convalidated:true});
    await db.exec('UPDATE "Tenant.Space"."Parent Accounts" SET "Account ID"=2 WHERE "Account ID"=1;');
    assert.deepEqual((await db.query('SELECT * FROM "Tenant.Space"."Order.Items"')).rows,[{'Account ID':2,'Region ID':10}]);
    await assert.rejects(db.exec('INSERT INTO "Tenant.Space"."Order.Items" VALUES(NULL,10)'),error=>error.code==='23503');
    await db.exec('DELETE FROM "Tenant.Space"."Parent Accounts";');
    assert.deepEqual((await db.query('SELECT * FROM "Tenant.Space"."Order.Items"')).rows,[{'Account ID':null,'Region ID':null}]);
  }finally{await db.close();}
});

test('Conditional and unsupported column clauses cannot produce lossy executable drafts',()=>{
  for(const sql of [
    'ALTER TABLE records ADD COLUMN IF NOT EXISTS token double precision DEFAULT random();',
    'ALTER TABLE records ADD COLUMN token double precision DEFAULT random() CHECK(token > 0.5);'
  ]){
    const analysis=engine.analyze(sql);
    assert.equal(analysis.analysisComplete,false,sql);
    assert.throws(()=>AutoSplitter.generatePlan(analysis),error=>error.statusCode===422,sql);
  }
  const unsupported=AutoSplitter.generatePlan(engine.analyze('ALTER TABLE records ADD CONSTRAINT records_uq UNIQUE(id) WITH(fillfactor=75);'));
  assert.equal(unsupported.phases.length,0);
  assert.ok(unsupported.manualSteps.some(step=>step.ruleId==='LG-005'));
});

test('ONLY NOT NULL can leave inherited child NULLs intact and must not become a recursive enforcement draft',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE scope_parent(id int); CREATE TABLE scope_child() INHERITS(scope_parent); INSERT INTO scope_child VALUES(NULL);');
    const original='ALTER TABLE ONLY scope_parent ALTER COLUMN id SET NOT NULL;';
    await db.exec(original);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM scope_child WHERE id IS NULL')).rows[0].n,1);
    const analysis=engine.analyze(original);
    assert.equal(analysis.analysisComplete,false);
    assert.throws(()=>AutoSplitter.generatePlan(analysis),error=>error.statusCode===422);
  }finally{await db.close();}
});

test('Legacy PostgreSQL NOT NULL drafts require manual review instead of a scan-free enforcement recipe',()=>{
  const analysis=engine.analyze("SET lock_timeout='3s'; ALTER TABLE records ALTER COLUMN id SET NOT NULL;",{pgVersion:11});
  const plan=AutoSplitter.generatePlan(analysis);
  assert.ok(plan.manualSteps.some(step=>step.ruleId==='LG-009'));
  assert.doesNotMatch(plan.phases.map(phase=>phase.sql).join('\n'),/SET NOT NULL/);
});
