const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const {RuleEngine}=require('../src/core');
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
