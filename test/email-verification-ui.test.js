const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {parseHTML}=require('linkedom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const source=name=>fs.readFileSync(path.join(__dirname,'../src/ui',name),'utf8');
function verificationPage(user,confirmStatus=200){
  const {document,Event}=parseHTML(source('verify-email.html')),calls=[];
  const location=new URL('https://account.example.invalid/verify-email.html?lang=ru#token='+'a'.repeat(64));
  const scope={document,Event,location,history:{replaceState(state,title,url){location.href=new URL(url,location).href;}},URLSearchParams,
    fetch:async(url,options)=>{calls.push({url,options});return{ok:url.includes('/confirm')?confirmStatus===200:true,status:confirmStatus,json:async()=>({user:url.includes('/confirm')?{...user,emailVerified:true}:user})};}};
  vm.runInNewContext(source('verify-email.js'),scope);return {document,Event,calls,location};
}
test('Verification page strips fragments, performs no mutation on open and requires matching sign-in',async()=>{
  const p=verificationPage(null);await flush();
  assert.equal(p.location.hash,'');assert.equal(p.calls.length,1);assert.equal(p.calls[0].url,'/api/v1/auth/session');
  assert.equal(p.document.getElementById('verify-confirm').disabled,true);assert.ok(!p.document.body.textContent.includes('a'.repeat(64)));
  assert.equal(p.document.getElementById('verify-login').hidden,false);
});
test('Confirmation is explicit, server rejection stays visible and email is rendered as text',async()=>{
  const p=verificationPage({email:'<img>@example.invalid',emailVerified:false},400);await flush();
  assert.equal(p.document.querySelector('img'),null);assert.equal(p.document.getElementById('verify-confirm').disabled,false);
  p.document.getElementById('verify-confirm').dispatchEvent(new p.Event('click'));await flush();
  assert.equal(p.calls[1].options.method,'POST');assert.equal(JSON.parse(p.calls[1].options.body).token,'a'.repeat(64));
  assert.match(p.document.getElementById('verify-message').textContent,/другому аккаунту/);
  p.document.getElementById('verify-language').dispatchEvent(new p.Event('click'));
  assert.match(p.document.getElementById('verify-message').textContent,/another account/);
});
test('Late verification responses cannot restore old account state and status refresh preserves SQL',async()=>{
  const {document,Event}=parseHTML('<html><body><div id="account-profile"></div><textarea id="sql-input">SELECT private_sql;</textarea></body></html>');
  let finish;const app={identityVersion:1,account:{id:'user-one',emailVerified:false,organizationId:'org-one'},emailVerificationEnabled:true,showAccountState(){this.emailVerification.render();},showToast(){}};
  const window={LockGuardI18n:{locale:'ru-RU'}};let delay=false;
  const scope={window,document,apiFetch:async()=>delay?new Promise(resolve=>{finish=resolve;}):{json:async()=>({user:{id:'user-one',emailVerified:true,emailVerifiedAt:'2026-01-01'},emailVerificationEnabled:true})}};
  vm.runInNewContext(source('email-verification.js'),scope);app.emailVerification=new window.LockGuardEmailVerification(app);
  await app.emailVerification.refresh();assert.equal(app.account.emailVerified,true);assert.equal(app.account.organizationId,'org-one');assert.equal(document.getElementById('sql-input').value,'SELECT private_sql;');
  app.account.emailVerified=false;delay=true;const pending=app.emailVerification.request();await flush();
  app.identityVersion++;app.account=null;app.emailVerification.reset();finish({json:async()=>({acceptedByProvider:true})});await pending;
  assert.equal(app.emailVerification.host.hidden,true);assert.equal(app.emailVerification.status.textContent,'');assert.equal(app.account,null);
});
