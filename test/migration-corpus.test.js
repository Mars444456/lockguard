require('./helpers/initialize');
const test=require('node:test');
const assert=require('node:assert/strict');
const {RuleEngine,SchemaCatalog,AutoSplitter}=require('../src/core');
const corpus=require('./corpus/rules.cases.json');
const engine=new RuleEngine();

test('Synthetic migration corpus names independent expectations for all twelve rules',()=>{
  assert.equal(corpus.version,1);
  assert.equal(new Set(corpus.cases.map(entry=>entry.id)).size,corpus.cases.length,'Case IDs must be stable and unique');
  for(const rule of engine.getRules()){
    assert.ok(corpus.cases.some(entry=>entry.expected.present.includes(rule.id)),rule.id+' needs a risk case');
    assert.ok(corpus.cases.some(entry=>entry.expected.absent.includes(rule.id)),rule.id+' needs a contrasting case');
  }
  for(const entry of corpus.cases)assert.ok(entry.reason&&entry.sql,'Each case must explain its independently expected SQL behavior');
});

for(const entry of corpus.cases)test('Migration corpus: '+entry.id,()=>{
  const options={...entry.options,filename:entry.id+'.sql'};
  if(entry.schemaSql)options.schema=SchemaCatalog.fromSQL(entry.schemaSql,{pgVersion:entry.schemaVersion||options.pgVersion||17});
  const result=engine.analyze(entry.sql,options),expected=entry.expected;
  for(const rule of expected.present)assert.ok(result.violations.some(v=>v.ruleId===rule),rule+' must be reported: '+entry.reason);
  for(const rule of expected.absent)assert.ok(!result.violations.some(v=>v.ruleId===rule),rule+' must not be reported: '+entry.reason);
  if(expected.finding){
    const {ruleId,...fields}=expected.finding,finding=result.violations.find(v=>v.ruleId===ruleId);
    assert.ok(finding,ruleId+' needs a finding for evidence assertions');
    for(const [name,value] of Object.entries(fields))assert.deepEqual(finding[name],value,ruleId+'.'+name+': '+entry.reason);
  }
  if(expected.count)assert.equal(result.violations.filter(v=>v.ruleId===expected.count.ruleId).length,expected.count.value);
  assert.equal(result.analysisComplete,expected.analysisComplete??true,'Semantic analysis completeness');
  assert.equal(result.coverageComplete,expected.coverageComplete??true,'Rule coverage completeness');
  if(expected.status)assert.equal(result.status,expected.status);
  if(expected.disabledRuleIds)assert.deepEqual(result.coverage.disabledRuleIds,expected.disabledRuleIds);
  if(expected.suppressedRuleIds)assert.deepEqual(result.coverage.suppressedFindings.map(v=>v.ruleId),expected.suppressedRuleIds);
  if(!result.analysisComplete||!result.coverageComplete){
    assert.notEqual(result.status,'PASSED','Unknown or excluded work cannot be an all-clear result');
    assert.throws(()=>AutoSplitter.generatePlan(result),/incomplete|unsupported/i,'Partial analysis must not create a release draft');
  }
});
