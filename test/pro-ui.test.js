require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const {RuleEngine}=require('../src/core');
async function page() {
  const {document,Event}=parseHTML(fs.readFileSync(path.join(__dirname,'../src/ui/index.html'),'utf8'));
  for(const form of document.querySelectorAll('form'))form.reset=function(){for(const input of this.querySelectorAll('input,textarea'))input.value='';};
  for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value') || this.querySelector('option')?.getAttribute('value') || '';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.getAttribute('value')===value);}});
  const engine=new RuleEngine(),calls=[],profile={id:'schema-a',name:'<img src=x onerror=alert(1)>',revision:'a'.repeat(64),summary:{tables:2,indexes:1,pgVersion:17}};
  let authenticated=false,licensed=false,delayedSchemas;
  const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  const user={id:'u1',email:'qa@example.invalid',organizationId:'org-a'},organization={name:'QA',plan:'free'};
  const window={location:{search:''},confirm:()=>false};
  const fetch=async(url,options={})=>{
    calls.push({url,options});
    if(url==='/api/v1/auth/session')return response({user:authenticated?user:null,registrationEnabled:true});
    if(url==='/api/v1/auth/login'){authenticated=true;return response({user});}
    if(url==='/api/v1/auth/logout'){authenticated=false;return response({success:true});}
    if(url==='/api/v1/organization')return response({organization});
    if(url==='/api/v1/rules')return response({rules:[]});
    if(url==='/api/v1/keys')return response({keys:[]});
    if(url==='/api/v1/runs')return response({runs:[]});
    if(url==='/api/v1/schemas')return delayedSchemas?delayedSchemas():response({schemas:licensed?[profile]:[],features:{pro:licensed}});
    if(url==='/api/v1/analyze')return response({data:{...engine.analyze(JSON.parse(options.body).sql),markdownReport:'report'}});
    if(url.startsWith('/api/v1/runs/compare?'))return response({comparison:{resolved:[{ruleId:'LG-002',ruleName:'index',table:'<script>test</script>',line:1}],introduced:[],persisting:[],contextChanged:true}});
    throw new Error('Unexpected '+url);
  };
  const scope={window,document,Event,console,fetch,Headers,URLSearchParams,URL,Blob,navigator:{clipboard:{writeText:async()=>{}}},setTimeout:(fn,ms)=>ms===3500?0:setTimeout(fn,ms),clearTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui/pro.js'),'utf8'),scope);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui/app.js'),'utf8'),scope);
  await window.app.ready;
  return {app:window.app,document,Event,calls,profile,response,license:value=>licensed=value,delay:value=>delayedSchemas=value};
}
test('Pro controls stay locked for guests and use server features after login',async()=>{
  const {app,document,license,profile}=await page();
  assert.equal(document.getElementById('schema-fields').disabled,true);
  document.getElementById('account-email').value='qa@example.invalid';document.getElementById('account-password').value='QA password 2026';
  await app.submitAccount();app.organization.plan='team';await app.pro.refresh();
  assert.equal(document.getElementById('schema-fields').disabled,true,'A client plan field is insufficient');
  license(true);await app.pro.refresh();
  assert.equal(document.getElementById('schema-fields').disabled,false);
  assert.equal(app.pro.profiles[0].id,profile.id);
  assert.equal(document.querySelector('#schema-list img'),null,'Untrusted names are text');
});
test('Selected schema reaches analysis and changed context invalidates old results',async()=>{
  const {app,document,calls,license,Event,profile}=await page();
  app.account={id:'u1'};license(true);await app.pro.refresh();
  document.getElementById('analysis-schema-select').value=profile.id;
  document.getElementById('sql-input').value='CREATE INDEX ix ON orders(id);';await app.analyzeCurrentSql();
  assert.equal(JSON.parse(calls.findLast(c=>c.url==='/api/v1/analyze').options.body).schemaId,profile.id);
  document.getElementById('analysis-schema-select').dispatchEvent(new Event('change'));
  assert.equal(document.getElementById('analysis-details').classList.contains('hidden'),true);
  assert.equal(app.latestMarkdownReport,'');
});
test('Comparison renders findings as text and warns when schema revisions differ',async()=>{
  const {app,document,license}=await page();app.account={id:'u1'};license(true);await app.pro.refresh();
  app.pro.setRuns([{id:'a',findingsVersion:1,analysisComplete:true,timestamp:new Date().toISOString(),filename:'migration.sql',violationsCount:1},{id:'b',findingsVersion:1,analysisComplete:true,timestamp:new Date().toISOString(),filename:'migration.sql',violationsCount:0}]);
  await app.pro.compare();
  assert.ok(document.getElementById('comparison-result').textContent.includes('<script>test</script>'));
  assert.equal(document.querySelector('#comparison-result script'),null);
  assert.ok(document.getElementById('compare-message').textContent.includes('Снимки схем различаются'));
});
test('Logout clears schema source and delayed profile responses cannot restore private data',async()=>{
  const {app,document,license,delay,response,profile}=await page();app.account={id:'u1'};license(true);await app.pro.refresh();
  document.getElementById('schema-source').value='private schema';
  let finish;delay(()=>new Promise(resolve=>finish=resolve));const pending=app.pro.refresh();
  app.resetPrivateData();finish(response({schemas:[profile],features:{pro:true}}));await pending;
  assert.equal(document.getElementById('schema-source').value,'');
  assert.equal(app.pro.profiles.length,0);assert.equal(app.pro.pro,false);
  assert.equal(document.getElementById('schema-fields').disabled,true);
});
