require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-email-http-'));
Object.assign(process.env,{NODE_ENV:'test',LOCKGUARD_DB_FILE:path.join(directory,'http.sqlite3'),LOCKGUARD_MAIL_API_KEY:'',LOCKGUARD_MAIL_FROM:''});
const server=require('../src/server/server'),db=require('../src/server/db');let base;
const password='Email ownership test password 2026';
async function request(route,body,cookie,extra={}){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;process.env.APP_URL=base;});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(directory,{recursive:true,force:true});});
test('Registration cannot self-verify; confirmation requires the matching signed-in account and same origin',async()=>{
  const a=await request('/api/v1/auth/register',{email:'http-proof-a@example.invalid',password,organizationName:'Mailbox A',emailVerified:true});
  const b=await request('/api/v1/auth/register',{email:'http-proof-b@example.invalid',password,organizationName:'Mailbox B'});
  assert.equal(a.body.user.emailVerified,false);assert.equal(a.body.emailVerificationEnabled,false);
  const unavailable=await request('/api/v1/auth/email-verification/request',{},a.cookie);assert.equal(unavailable.status,503);assert.equal(unavailable.body.code,'MAIL_UNAVAILABLE');
  const proof=db.emailVerification.issue(a.body.user.id);
  assert.equal((await request('/api/v1/auth/email-verification/confirm',{token:proof.token})).status,401);
  assert.equal((await request('/api/v1/auth/email-verification/confirm',{token:proof.token},b.cookie)).status,400);
  assert.equal((await request('/api/v1/auth/email-verification/confirm',{token:proof.token},a.cookie,{Origin:'https://attacker.invalid'})).status,403);
  const confirmed=await request('/api/v1/auth/email-verification/confirm',{token:proof.token},a.cookie);
  assert.equal(confirmed.status,200);assert.equal(confirmed.body.user.emailVerified,true);
  assert.equal((await request('/api/v1/auth/session',undefined,a.cookie)).body.user.emailVerified,true);
  assert.equal((await request('/api/v1/auth/email-verification/confirm',{token:proof.token},a.cookie)).status,400);
});
