const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const {RuleEngine}=require('../src/core');
const {AutoSplitter,PgParser,SchemaCatalog}=require('../src/core');
const connectionString = process.env.LOCKGUARD_TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set LOCKGUARD_TEST_DATABASE_URL to a disposable local database named *_test.');
const url = new URL(connectionString);
if (!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname) || !/(^|_)test$/.test(url.pathname.slice(1))) throw new Error('Live tests accept only a local disposable *_test database.');
const schema = 'lockguard_test_' + randomBytes(8).toString('hex');
let observer;
async function connect() {
  const c = new Client({ connectionString, connectionTimeoutMillis:5000, query_timeout:10000 });
  await c.connect();
  await c.query(`SET search_path TO "${schema}"; SET statement_timeout='8s'`);
  return c;
}
async function waiting(pid) {
  const deadline = Date.now()+4000;
  while(Date.now()<deadline) {
    const {rows}=await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
    if(rows[0]?.wait_event_type==='Lock')return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Expected a real PostgreSQL lock wait');
}
test.before(async()=>{
  await RuleEngine.initialize();
  observer=await connect();
  await observer.query(`CREATE SCHEMA "${schema}"`);
  await observer.query('CREATE TABLE accounts(id int PRIMARY KEY); INSERT INTO accounts VALUES(1); CREATE TABLE orders(id int, account_id int);');
});
test.after(async()=>{
  if(observer) { assert.match(schema,/^lockguard_test_[a-f0-9]{16}$/); await observer.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await observer.end(); }
});

test('Generated unique plans preserve INCLUDE and deferrability on the target PostgreSQL version',async()=>{
  await observer.query('CREATE TABLE unique_probe(email text,payload int); INSERT INTO unique_probe VALUES(NULL,1)');
  const {rows:[{version}]}=await observer.query("SELECT current_setting('server_version_num')::int/10000 AS version");
  const sql=`ALTER TABLE unique_probe ADD CONSTRAINT "Unique Plan" UNIQUE ${version>=15?'NULLS NOT DISTINCT ':''}(email) INCLUDE(payload) DEFERRABLE INITIALLY DEFERRED;`;
  const plan=AutoSplitter.generatePlan(new RuleEngine().analyze(sql,{pgVersion:version}));
  for(const phase of plan.phases)for(const stmt of PgParser.parse(phase.sql))await observer.query(stmt.raw);
  const {rows:[constraint]}=await observer.query("SELECT condeferrable,condeferred FROM pg_constraint WHERE conrelid='unique_probe'::regclass");
  assert.equal(constraint.condeferrable,true);assert.equal(constraint.condeferred,true);
  if(version>=15)await assert.rejects(observer.query('INSERT INTO unique_probe VALUES(NULL,2)'),error=>error.code==='23505');
});

test('Generated foreign-key validation preserves CASCADE and handles comments and multiple ALTER actions',async()=>{
  await observer.query('CREATE TABLE fk_parent_probe(id int PRIMARY KEY); CREATE TABLE fk_child_probe(pid int)');
  const sql='/* UTF-8 миграция */ ALTER /* note */ TABLE fk_child_probe ADD COLUMN note text, ADD CONSTRAINT "Foreign Plan" FOREIGN KEY(pid) REFERENCES fk_parent_probe(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;';
  const plan=AutoSplitter.generatePlan(new RuleEngine().analyze(sql));
  for(const phase of plan.phases)for(const stmt of PgParser.parse(phase.sql))await observer.query(stmt.raw);
  const {rows:[constraint]}=await observer.query("SELECT confdeltype,condeferrable,condeferred,convalidated FROM pg_constraint WHERE conrelid='fk_child_probe'::regclass");
  assert.deepEqual(constraint,{confdeltype:'c',condeferrable:true,condeferred:true,convalidated:true});
});
test('ALTER TABLE waits behind SELECT and lock_timeout cancels the DDL',async()=>{
  const reader=await connect(), ddl=await connect();
  try {
    await reader.query('BEGIN; SELECT * FROM orders');
    await ddl.query("SET lock_timeout='500ms'");
    const pending=ddl.query('ALTER TABLE orders ADD COLUMN note text').then(()=>null,error=>error);
    await waiting(ddl.processID);
    const error=await pending;
    assert.equal(error?.code,'55P03');
    assert.equal((await observer.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='orders' AND column_name='note'",[schema])).rows[0].count,0);
  } finally { await reader.query('ROLLBACK'); await Promise.all([reader.end(),ddl.end()]); }
});

test('Type evidence matches real heap rewrites, and widening VARCHAR still acquires ACCESS EXCLUSIVE',async()=>{
  const {SchemaCatalog}=require('../src/core');
  await observer.query('CREATE TABLE type_probe(name varchar(100),n integer); INSERT INTO type_probe VALUES(\'example\',1)');
  const {rows:[{version}]}=await observer.query("SELECT current_setting('server_version_num')::int / 10000 AS version");
  const schema=SchemaCatalog.fromSQL('CREATE TABLE type_probe(name varchar(100),n integer);',{pgVersion:version});
  const result=new RuleEngine().analyze("SET lock_timeout='3s'; ALTER TABLE type_probe ALTER COLUMN name TYPE varchar(200);",{schema});
  assert.equal(result.violations.find(v=>v.ruleId==='LG-004').rewrite,'not-required');
  const file=async()=>(await observer.query("SELECT relfilenode::text AS file FROM pg_class WHERE oid='type_probe'::regclass")).rows[0].file;
  const before=await file(),ddl=await connect();
  try {
    await ddl.query('BEGIN; ALTER TABLE type_probe ALTER COLUMN name TYPE varchar(200)');
    const {rows}=await observer.query("SELECT mode FROM pg_locks WHERE pid=$1 AND relation='type_probe'::regclass AND granted",[ddl.processID]);
    assert.ok(rows.some(row=>row.mode==='AccessExclusiveLock'));
    await ddl.query('COMMIT');assert.equal(await file(),before);
    await observer.query('ALTER TABLE type_probe ALTER COLUMN n TYPE bigint');assert.notEqual(await file(),before);
  }finally{await ddl.query('ROLLBACK');await ddl.end();}
});
test('Ordinary CREATE INDEX queues writes; CONCURRENTLY lets a new writer proceed while waiting for an older writer',async()=>{
  for(const concurrent of [false,true]) {
    const blocker=await connect(), ddl=await connect(), writer=await connect();
    let pending;
    try {
      await blocker.query('BEGIN; INSERT INTO orders VALUES(10,1)');
      await ddl.query("SET lock_timeout='5s'");
      pending=ddl.query(`CREATE INDEX ${concurrent?'CONCURRENTLY ':''}ix_${concurrent?'concurrent':'plain'} ON orders(account_id)`).then(()=>null,error=>error);
      await waiting(ddl.processID);
      await writer.query("SET lock_timeout='250ms'");
      if(concurrent) await writer.query('INSERT INTO orders VALUES(20,1)');
      else await assert.rejects(writer.query('INSERT INTO orders VALUES(20,1)'),error=>error.code==='55P03');
      await blocker.query('ROLLBACK');
      assert.equal(await pending,null);
    } finally {
      await blocker.query('ROLLBACK');
      if(pending)await pending;
      await Promise.all([blocker.end(),ddl.end(),writer.end()]);
    }
  }
});
test('ADD FOREIGN KEY holds SHARE ROW EXCLUSIVE: reads proceed and writes wait',async()=>{
  const result=new RuleEngine().analyze("SET lock_timeout='3s'; ALTER TABLE orders ADD CONSTRAINT fk_account FOREIGN KEY(account_id) REFERENCES accounts(id);");
  assert.equal(result.violations.find(v=>v.ruleId==='LG-003').lockLevel,'SHARE ROW EXCLUSIVE');
  for(const notValid of [false,true]) {
  const ddl=await connect(), other=await connect();
  try {
    await ddl.query('BEGIN; ALTER TABLE orders ADD CONSTRAINT fk_account FOREIGN KEY(account_id) REFERENCES accounts(id)'+(notValid?' NOT VALID':''));
    const {rows}=await observer.query("SELECT mode FROM pg_locks WHERE pid=$1 AND relation='orders'::regclass AND granted",[ddl.processID]);
    assert.ok(rows.some(row=>row.mode==='ShareRowExclusiveLock'));
    await other.query("SET lock_timeout='250ms'; SELECT * FROM orders");
    await assert.rejects(other.query('INSERT INTO orders VALUES(30,1)'),error=>error.code==='55P03');
  } finally {await ddl.query('ROLLBACK');await Promise.all([ddl.end(),other.end()]);}
  }
});

test('Repeated BEGIN does not replace the outer rollback snapshot for lock_timeout',async()=>{
  const client=await connect();
  try{
    await client.query("SET lock_timeout='0'; BEGIN; SET lock_timeout='3s'; BEGIN; ROLLBACK;");
    assert.equal((await client.query('SHOW lock_timeout')).rows[0].lock_timeout,'0');
    const result=new RuleEngine().analyze("BEGIN; SET lock_timeout='3s'; BEGIN; ROLLBACK; ALTER TABLE orders ADD COLUMN nested_probe int;");
    assert.ok(result.violations.some(finding=>finding.ruleId==='LG-008'));
  }finally{await client.query('ROLLBACK');await client.end();}
});

test('COMMIT and ROLLBACK AND CHAIN both retain a transaction that forbids VACUUM',async()=>{
  await observer.query('CREATE TABLE chain_boundary_probe(id int)');
  for(const end of ['COMMIT','ROLLBACK']){
    const client=await connect();
    try{
      await client.query('BEGIN');await client.query(end+' AND CHAIN');
      await assert.rejects(client.query('VACUUM chain_boundary_probe'),error=>error.code==='25001');
      await client.query('ROLLBACK');await client.query('VACUUM chain_boundary_probe');
      const analysis=new RuleEngine().analyze('BEGIN; '+end+' AND CHAIN; VACUUM chain_boundary_probe; ROLLBACK;');
      assert.ok(analysis.violations.some(finding=>finding.ruleId==='LG-007'));
    }finally{await client.query('ROLLBACK');await client.end();}
  }
});

test('A reordered leading btree key set supports equality lookup for a composite foreign key',async()=>{
  const ddl='CREATE TABLE fk_order_parent(a int,b int,PRIMARY KEY(a,b)); CREATE TABLE fk_order_child(a int,b int); CREATE INDEX fk_order_child_ba ON fk_order_child(b,a);';
  await observer.query(ddl);
  await observer.query('INSERT INTO fk_order_parent SELECT n,n%11 FROM generate_series(1,1000) n; INSERT INTO fk_order_child SELECT * FROM fk_order_parent; ANALYZE fk_order_child;');
  const foreignKey='ALTER TABLE fk_order_child ADD CONSTRAINT fk_order_pair FOREIGN KEY(a,b) REFERENCES fk_order_parent(a,b) NOT VALID;';
  await observer.query(foreignKey);
  const client=await connect();
  try{
    await client.query('SET enable_seqscan=off; SET enable_bitmapscan=off;');
    const {rows}=await client.query('EXPLAIN (FORMAT JSON,COSTS OFF) SELECT 1 FROM fk_order_child WHERE a=17 AND b=6');
    const plan=rows[0]['QUERY PLAN'][0].Plan;
    assert.equal(plan['Index Name'],'fk_order_child_ba');
    assert.match(plan['Index Cond'],/\ba = 17\b/);assert.match(plan['Index Cond'],/\bb = 6\b/);
    const analysis=new RuleEngine().analyze("SET lock_timeout='3s'; "+foreignKey,{schema:SchemaCatalog.fromSQL(ddl)});
    assert.equal(analysis.violations.filter(finding=>finding.ruleId==='LG-011').length,0);
    assert.deepEqual(analysis.cascadeWarnings,[]);
  }finally{await client.end();}
});

test('ONLY NOT NULL preserves nullable inherited children and is not rewritten as recursive DDL',async()=>{
  await observer.query('CREATE TABLE only_scope_parent(id int); CREATE TABLE only_scope_child() INHERITS(only_scope_parent); INSERT INTO only_scope_child VALUES(NULL);');
  const original='ALTER TABLE ONLY only_scope_parent ALTER COLUMN id SET NOT NULL;';
  await observer.query(original);
  assert.equal((await observer.query('SELECT count(*)::int AS n FROM only_scope_child WHERE id IS NULL')).rows[0].n,1);
  const analysis=new RuleEngine().analyze(original);
  assert.equal(analysis.analysisComplete,false);
  assert.throws(()=>AutoSplitter.generatePlan(analysis),error=>error.statusCode===422);
});

test('Rolled-back CHECK validation cannot prove a later NOT NULL operation',async()=>{
  await observer.query('CREATE TABLE rollback_proof_probe(value int); INSERT INTO rollback_proof_probe VALUES(1)');
  const client=await connect();
  const sql='BEGIN; ALTER TABLE rollback_proof_probe ADD CONSTRAINT rollback_nn CHECK(value IS NOT NULL) NOT VALID; ALTER TABLE rollback_proof_probe VALIDATE CONSTRAINT rollback_nn; ROLLBACK;';
  try{
    await client.query(sql);
    const {rows:[{n}]}=await client.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='rollback_proof_probe'::regclass AND conname='rollback_nn'");
    assert.equal(n,0);
    const analysis=new RuleEngine().analyze("SET lock_timeout='3s'; "+sql+' ALTER TABLE rollback_proof_probe ALTER COLUMN value SET NOT NULL;');
    assert.ok(analysis.violations.some(finding=>finding.ruleId==='LG-009'));
  }finally{await client.query('ROLLBACK');await client.end();}
});
