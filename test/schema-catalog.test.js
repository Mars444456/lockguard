require('./helpers/initialize');
const test=require('node:test'), assert=require('node:assert/strict');
const {SchemaCatalog,RuleEngine}=require('../src/core');
const engine=new RuleEngine();
const ddl='CREATE TABLE accounts(id int PRIMARY KEY); CREATE TABLE orders(id int, account_id int); CREATE INDEX ix_account ON orders(account_id);';
const migration="SET lock_timeout='3s'; ALTER TABLE orders ADD CONSTRAINT fk_a FOREIGN KEY(account_id) REFERENCES accounts(id) NOT VALID;";
const check=(schema,sql=migration)=>engine.analyze(sql,{schema}).violations.filter(v=>v.ruleId==='LG-011');
test('Passing a rule check does not hide table locks of concurrent indexes or validated NOT NULL',()=>{
  const concurrent=engine.analyze("SET lock_timeout='3s'; CREATE INDEX CONCURRENTLY ix ON orders(id);");
  assert.equal(concurrent.passed,true);assert.equal(concurrent.highestLockLevel,'SHARE UPDATE EXCLUSIVE');
  const schema=SchemaCatalog.fromSQL('CREATE TABLE accounts(id int, CONSTRAINT nn CHECK(id IS NOT NULL));');
  const notNull=engine.analyze("SET lock_timeout='3s'; ALTER TABLE accounts ALTER COLUMN id SET NOT NULL;",{schema});
  assert.equal(notNull.violationsCount,0);assert.equal(notNull.highestLockLevel,'ACCESS EXCLUSIVE');
  assert.equal(engine.analyze('UPDATE orders SET id=1;').highestLockLevel,'ROW EXCLUSIVE');
});
test('SQL import keeps only structure; existing indexes eliminate LG-011 without executing SQL',()=>{
  const schema=SchemaCatalog.fromSQL(ddl);
  assert.deepEqual(schema.summary(),{tables:2,columns:3,indexes:2,pgVersion:17,defaultSchema:'public'});
  assert.equal(check(null).length,1);
  assert.equal(check(schema).length,0);
  const result=engine.analyze(migration,{schema});
  assert.equal(result.schemaContext.source,'imported_snapshot');
  assert.equal(result.schemaContext.verifiedAgainstDatabase,false);
});
test('Schema-aware index checks require a valid full btree prefix in the correct schema',()=>{
  for(const patch of [{partial:true},{expression:true},{valid:false},{method:'hash'},{columns:['id','account_id']}]) {
    const schema=SchemaCatalog.fromSQL(ddl).toJSON(); Object.assign(schema.tables[1].indexes[0],patch);
    assert.equal(check(schema).length,1,JSON.stringify(patch));
  }
  const schema=SchemaCatalog.fromSQL(ddl.replaceAll('orders','archive.orders').replace('CREATE TABLE accounts','CREATE SCHEMA archive; CREATE TABLE accounts'));
  assert.equal(check(schema).length,1,'An archive index cannot satisfy public.orders');
  assert.equal(check(schema,migration.replace('TABLE orders','TABLE archive.orders')).length,0);
});
test('Dropped indexes, invalidated constraints and changed search_path cannot reuse stale evidence',()=>{
  const schema=SchemaCatalog.fromSQL(ddl);
  for(const prefix of ['DROP INDEX ix_account;','ALTER TABLE orders DROP COLUMN id;','SET search_path=archive;']) assert.equal(check(schema,prefix+migration).length,1,prefix);
  const later=migration+'CREATE INDEX CONCURRENTLY later_ix ON orders(account_id);';
  assert.equal(check(null,later).length,1,'An index built later is absent at FK creation');
});
test('IF NOT EXISTS and custom index semantics cannot invent evidence for a foreign key',()=>{
  const schema=SchemaCatalog.fromSQL('CREATE TABLE accounts(id int); CREATE TABLE orders(id int,account_id int); CREATE INDEX ix_account ON orders(id);');
  assert.equal(check(schema,'CREATE INDEX IF NOT EXISTS ix_account ON orders(account_id);'+migration).length,1);
  const custom=SchemaCatalog.fromSQL('CREATE TABLE orders(account_id text); CREATE INDEX ix_account ON orders(account_id text_pattern_ops);');
  assert.equal(check(custom).length,1);
});
test('A NOT ENFORCED check or a changed search_path cannot prove NOT NULL',()=>{
  const catalog=SchemaCatalog.fromSQL('CREATE TABLE accounts(id int, CONSTRAINT nn CHECK(id IS NOT NULL) NOT ENFORCED);');
  const sql="SET lock_timeout='3s'; ALTER TABLE accounts ALTER COLUMN id SET NOT NULL;";
  assert.ok(engine.analyze(sql,{schema:catalog}).violations.some(v=>v.ruleId==='LG-009'));
  assert.throws(()=>SchemaCatalog.fromSQL('CREATE TABLE accounts(id int, CONSTRAINT nn CHECK(id IS NOT NULL) NOT ENFORCED); ALTER TABLE accounts VALIDATE CONSTRAINT nn;'));
  const changed="ALTER TABLE accounts ADD CONSTRAINT nn CHECK(id IS NOT NULL) NOT VALID; ALTER TABLE accounts VALIDATE CONSTRAINT nn; SET search_path=archive;"+sql;
  assert.ok(engine.analyze(changed).violations.some(v=>v.ruleId==='LG-009'));
});
test('Quoted identifiers and dots inside names keep their identity',()=>{
  const schema=SchemaCatalog.fromSQL('CREATE TABLE "odd.schema"."Order.Items"("Account ID" int); CREATE INDEX "Index.name" ON "odd.schema"."Order.Items"("Account ID");');
  assert.equal(check(schema,'SET lock_timeout=\'3s\'; ALTER TABLE "odd.schema"."Order.Items" ADD CONSTRAINT fk FOREIGN KEY("Account ID") REFERENCES accounts(id) NOT VALID;').length,0);
});
test('Validated NOT NULL checks are used only for compatible versions and remain conservative after changes',()=>{
  const source='CREATE TABLE accounts(id int, CONSTRAINT id_nn CHECK(id IS NOT NULL));';
  const sql="SET lock_timeout='3s'; ALTER TABLE accounts ALTER COLUMN id SET NOT NULL;";
  const warnings=(schema,text=sql)=>engine.analyze(text,{schema}).violations.filter(v=>v.ruleId==='LG-009');
  assert.equal(warnings(SchemaCatalog.fromSQL(source)).length,0);
  assert.equal(warnings(SchemaCatalog.fromSQL(source,{pgVersion:11})).length,1);
  const pg11=SchemaCatalog.fromSQL('CREATE TABLE accounts(id int);',{pgVersion:11});
  assert.equal(warnings(pg11,'ALTER TABLE accounts ADD CONSTRAINT nn CHECK(id IS NOT NULL) NOT VALID; ALTER TABLE accounts VALIDATE CONSTRAINT nn;'+sql).length,1);
  const schema=SchemaCatalog.fromSQL(source).toJSON();schema.tables[0].checks[0].validated=false;
  assert.equal(warnings(schema).length,1);
  assert.equal(warnings(SchemaCatalog.fromSQL(source),'ALTER TABLE accounts DROP CONSTRAINT id_nn;'+sql).length,1);
});
test('Import rejects row data, routines, unexpected JSON, ambiguous schemas and excessive sizes',()=>{
  for(const sql of [ddl+'INSERT INTO accounts VALUES(1);',ddl+'COPY accounts FROM STDIN;',ddl+'DO $$ BEGIN NULL; END $$;',ddl+'SET search_path=archive;']) assert.throws(()=>SchemaCatalog.fromSQL(sql));
  const schema=SchemaCatalog.fromSQL(ddl).toJSON();
  assert.throws(()=>new SchemaCatalog({...schema,rows:[{secret:'must not be stored'}]}));
  assert.throws(()=>new SchemaCatalog({...schema,tables:[...schema.tables,schema.tables[0]]}));
  assert.throws(()=>SchemaCatalog.fromSQL(' '.repeat(512*1024+1)));
  assert.throws(()=>new SchemaCatalog({...schema,pgVersion:'17'}));
  assert.throws(()=>SchemaCatalog.fromSQL(ddl+'CREATE INDEX IF NOT EXISTS ix_account ON orders(id);'));
});
