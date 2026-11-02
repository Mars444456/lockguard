require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict');
const {RuleEngine,AutoSplitter}=require('../src/core');
const engine=new RuleEngine();
const proof='ALTER TABLE items ADD CONSTRAINT nn CHECK(id IS NOT NULL) NOT VALID; ALTER TABLE items VALIDATE CONSTRAINT nn;';
test('Shared NOT NULL evidence includes committed validation, never rolled-back or still-open transactions',()=>{
  for(const ending of ['ROLLBACK;','ABORT;','', 'COMMIT;']){
    const sharedState={validatedChecks:new Set()};
    engine.analyze("SET lock_timeout='3s'; BEGIN; "+proof+ending,{sharedState});
    assert.equal(sharedState.validatedChecks.has('items:id'),ending==='COMMIT;',ending||'open transaction');
    const next=engine.analyze("SET lock_timeout='3s'; ALTER TABLE items ALTER COLUMN id SET NOT NULL;",{sharedState});
    assert.equal(next.violations.some(v=>v.ruleId==='LG-009'),ending!=='COMMIT;',ending||'open transaction');
  }
});
test('Legacy volatile DEFAULT backfill never promises scan-free NOT NULL enforcement',()=>{
  const analysis=engine.analyze("SET lock_timeout='3s'; ALTER TABLE items ADD COLUMN token uuid DEFAULT gen_random_uuid() NOT NULL;",{pgVersion:11});
  const plan=AutoSplitter.generatePlan(analysis);
  assert.ok(plan.manualSteps.some(step=>step.kind==='not_null_version_review'));
  assert.match(plan.phases.map(p=>p.sql).join('\n'),/ADD COLUMN token UUID/);
  assert.doesNotMatch(plan.phases.map(p=>p.sql).join('\n'),/SET NOT NULL/);
});
test('CHAIN in a comment does not make an old-version transaction unsupported',()=>{
  const result=engine.analyze("SET lock_timeout='3s'; BEGIN; COMMIT /* AND CHAIN */; ALTER TABLE items ADD COLUMN note text;",{pgVersion:11});
  assert.equal(result.analysisComplete,true);assert.equal(result.violations.some(v=>v.ruleId==='LG-000'),false);
});
test('Dropped, replaced or same-command CHECK proofs cannot hide NOT NULL validation',()=>{
  for(const alteration of [
    'ALTER TABLE items DROP COLUMN id; ALTER TABLE items ADD COLUMN id int; ALTER TABLE items ALTER COLUMN id SET NOT NULL;',
    'ALTER TABLE items ALTER COLUMN id SET NOT NULL, DROP CONSTRAINT nn;'
  ]){
    const analysis=engine.analyze("SET lock_timeout='3s'; "+proof+alteration);
    assert.ok(analysis.violations.some(v=>v.ruleId==='LG-009'),alteration);
  }
  for(const table of ['items','public.items']){
    const sharedState={validatedChecks:new Set()};engine.analyze(proof,{sharedState});
    const analysis=engine.analyze("SET lock_timeout='3s'; ALTER TABLE "+table+' DROP CONSTRAINT nn; ALTER TABLE items ALTER COLUMN id SET NOT NULL;',{sharedState});
    assert.ok(analysis.violations.some(v=>v.ruleId==='LG-009'),table);
    assert.equal(sharedState.validatedChecks.size,0);
  }
});
