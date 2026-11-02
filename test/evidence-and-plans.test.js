require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { RuleEngine, SchemaCatalog, ShadowReplaySimulator, AutoSplitter, ContextAnalyzer } = require('../src/core');
const engine = new RuleEngine();
const change = (type, schema, prefix='', options={}) => engine.analyze(`${prefix}SET lock_timeout='3s'; ALTER TABLE customers ALTER COLUMN name TYPE ${type};`, {schema,...options}).violations.find(v=>v.ruleId==='LG-004');

test('Uncalibrated simulations cannot produce runtime predictions',()=>{
  const analysis=engine.analyze('CREATE INDEX ix ON customers(id);');
  assert.throws(()=>ShadowReplaySimulator.simulate(analysis),error=>error.statusCode===410);
  const context=ContextAnalyzer.enrich(analysis,{tables:{customers:{rowCount:0,sizeMb:0}}});
  assert.equal(context.hasTableMetrics,true);assert.equal(context.hasLiveContext,false);
  assert.equal(context.maxEstimatedDowntimeSec,null);
});

test('Type snapshot v2 retains types; v1 remains usable with unknown source type', () => {
  const schema=SchemaCatalog.fromSQL('CREATE TABLE customers(name varchar(100));');
  assert.equal(schema.version,2);assert.equal(schema.tables[0].columns[0].type.name,'varchar');
  assert.deepEqual(schema.tables[0].columns[0].type.modifiers,[100]);
  assert.equal(change('varchar(200)',schema).rewrite,'not-required');
  assert.equal(change('varchar(50)',schema).rewrite,'unknown');
  const legacy={version:1,pgVersion:17,tables:[{name:'customers',columns:[{name:'name'}]}]};
  assert.equal(change('varchar(200)',legacy).rewrite,'unknown');
  assert.equal(change('varchar(200)',schema,'',{pgVersion:14}).rewrite,'unknown');
  assert.equal(change('varchar(200) USING name::varchar(200)',schema).rewrite,'unknown');
  assert.equal(change('varchar(200) COLLATE "C"',schema).rewrite,'unknown');
  assert.equal(change('varchar(200)',schema,'SET search_path=archive;').rewrite,'unknown');
});

test('Type evidence follows statement order, qualified identifiers and invalidation', () => {
  const schema=SchemaCatalog.fromSQL('CREATE TABLE customers(name varchar(100));');
  const result=engine.analyze("SET lock_timeout='3s'; ALTER TABLE public.customers ALTER COLUMN name TYPE varchar(200); ALTER TABLE customers ALTER COLUMN name TYPE varchar(150);",{schema});
  assert.deepEqual(result.violations.filter(v=>v.ruleId==='LG-004').map(v=>v.rewrite),['not-required','unknown']);
  assert.equal(schema.tables[0].columns[0].type.modifiers[0],100,'Analysis must not mutate saved snapshots');
  assert.equal(change('varchar(200)',schema,'ALTER TABLE customers DROP COLUMN name; ALTER TABLE customers ADD COLUMN name text;').rewrite,'unknown');
  const custom=SchemaCatalog.fromSQL('CREATE TABLE customers(name public.my_domain);');
  assert.equal(change('varchar(200)',custom).rewrite,'unknown');
  const quoted=SchemaCatalog.fromSQL('CREATE TABLE "Odd.Name"("Display Name" varchar(10));');
  const q=engine.analyze('SET lock_timeout=3000; ALTER TABLE "Odd.Name" ALTER COLUMN "Display Name" TYPE varchar(20);',{schema:quoted});
  assert.equal(q.violations.find(v=>v.ruleId==='LG-004').rewrite,'not-required');
});

test('Integer rewrite and varchar widening match PostgreSQL storage behavior',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE TABLE customers(name varchar(100)); INSERT INTO customers VALUES(\'test\'); CREATE TABLE numbers(id integer); INSERT INTO numbers VALUES(1);');
    const file=async table=>(await db.query('SELECT relfilenode::text AS file FROM pg_class WHERE oid=$1::regclass',[table])).rows[0].file;
    const before=await file('customers');
    await db.exec('ALTER TABLE customers ALTER COLUMN name TYPE varchar(200);');
    assert.equal(await file('customers'),before);
    const numberFile=await file('numbers');
    await db.exec('ALTER TABLE numbers ALTER COLUMN id TYPE bigint;');
    assert.notEqual(await file('numbers'),numberFile);
    const schema=SchemaCatalog.fromSQL('CREATE TABLE customers(name integer);');
    assert.equal(change('bigint',schema).rewrite,'required');
  } finally {await db.close();}
});

test('Generated backfill is genuinely bounded and preserves non-null values across reruns',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE TABLE customers(id int PRIMARY KEY); INSERT INTO customers SELECT generate_series(1,5100);');
    const plan=AutoSplitter.generatePlan(engine.analyze("SET lock_timeout='3s'; ALTER TABLE customers ADD COLUMN token uuid DEFAULT gen_random_uuid() NOT NULL;"));
    await db.exec(plan.phases.find(p=>p.phaseNumber===1).sql);
    const batch=plan.phases.find(p=>p.phaseNumber===2).sql;
    await db.exec(batch);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM customers WHERE token IS NOT NULL')).rows[0].n,5000);
    const first=(await db.query('SELECT token FROM customers WHERE token IS NOT NULL LIMIT 1')).rows[0].token;
    await db.exec(batch);await db.exec(batch);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM customers WHERE token=$1',[first])).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM customers WHERE token IS NULL')).rows[0].n,0);
    for(const phase of plan.phases.filter(p=>p.phaseNumber>2))await db.exec(phase.sql);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM customers')).rows[0].n,5100);
    const manual=AutoSplitter.generatePlan(engine.analyze('ALTER TABLE customers ALTER COLUMN token TYPE text;'));
    assert.ok(manual.manualSteps.some(step=>step.kind==='type_change_review'));
    assert.doesNotMatch(manual.phases.map(p=>p.sql).join('\n'),/RENAME COLUMN|CREATE TRIGGER|DROP COLUMN/);
  } finally {await db.close();}
});
