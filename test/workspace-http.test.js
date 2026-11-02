require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-workspace-http-'));
process.env.LOCKGUARD_DB_FILE=path.join(directory,'http.sqlite3');process.env.NODE_ENV='test';
const server=require('../src/server/server'),db=require('../src/server/db');
let base,owner,reviewer,review;
const password='Workspace test password 2026';
async function request(route,body,cookie,extra={}) {const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(directory,{recursive:true,force:true});});

test('HTTP team roles prevent writes and require the expected active workspace',async()=>{
  owner=await request('/api/v1/auth/register',{email:'owner-http@example.invalid',password,organizationName:'Owner HTTP'});
  reviewer=await request('/api/v1/auth/register',{email:'review-http@example.invalid',password,organizationName:'Reviewer HTTP'});
  for(const account of [owner,reviewer])db.emailVerification.consume(account.body.user.id,db.emailVerification.issue(account.body.user.id).token);
  db.forOrganization(owner.body.user.organizationId).updatePlan('team');
  const invite=await request('/api/v1/team/invites',{email:reviewer.body.user.email,role:'reviewer'},owner.cookie);assert.equal(invite.status,201);
  const accept=await request('/api/v1/team/accept',{token:invite.body.invite.token},reviewer.cookie);assert.equal(accept.status,200);assert.equal(accept.body.user.role,'reviewer');
  assert.equal((await request('/api/v1/organization',{name:'spoof'},reviewer.cookie)).status,403);
  assert.equal((await request('/api/v1/analyze',{sql:'SELECT 1;',recordRun:true},reviewer.cookie)).status,403);
  assert.equal((await request('/api/v1/keys',{name:'spoof'},reviewer.cookie)).status,403);
  assert.equal((await request('/api/v1/team/invites',{email:'x@example.invalid',role:'editor'},reviewer.cookie)).status,403);
  const stale=await request('/api/v1/runs',undefined,reviewer.cookie,{'X-LockGuard-Workspace':reviewer.body.user.organizationId});assert.equal(stale.status,409);assert.equal(stale.body.code,'WORKSPACE_CHANGED');
  assert.equal((await request('/api/v1/operations',undefined,reviewer.cookie)).status,403);
});

test('HTTP review links require authentication and comments cannot cross organizations or revisions',async()=>{
  const run=await request('/api/v1/analyze',{sql:"SET lock_timeout='3s'; CREATE INDEX CONCURRENTLY ix ON customers(id);",recordRun:true},owner.cookie);
  const created=await request('/api/v1/reviews',{runId:run.body.data.runId,title:'Private HTTP review'},owner.cookie);assert.equal(created.status,201);review=created.body.review;
  assert.equal((await request('/api/v1/reviews/'+review.id)).status,401);
  const comment=await request('/api/v1/reviews/'+review.id+'/events',{kind:'comment',expectedRevision:1,text:'Reviewing on staging.'},reviewer.cookie);assert.equal(comment.status,200);
  assert.equal((await request('/api/v1/reviews/'+review.id+'/events',{kind:'comment',expectedRevision:1,text:'stale'},owner.cookie)).status,409);
  assert.equal((await request('/api/v1/reviews/'+review.id+'/events',{kind:'comment',expectedRevision:2,text:'cross-site'},owner.cookie,{Origin:'https://untrusted.invalid'})).status,403);
  await request('/api/v1/workspaces/select',{organizationId:reviewer.body.user.organizationId},reviewer.cookie);
  assert.equal((await request('/api/v1/reviews/'+review.id,undefined,reviewer.cookie)).status,404);
});

test('HTTP offline recovery revokes sessions and old codes, and allows login with only the new password',async()=>{
  assert.equal((await request('/api/v1/auth/recovery-code',{currentPassword:password})).status,401);
  const generated=await request('/api/v1/auth/recovery-code',{currentPassword:password},owner.cookie);assert.equal(generated.status,200);
  const next='Replacement password 2026';
  const recovered=await request('/api/v1/auth/recover',{email:owner.body.user.email,token:generated.body.recovery.token,password:next});assert.equal(recovered.status,200);
  assert.equal((await request('/api/v1/runs',undefined,owner.cookie)).status,401);
  assert.equal((await request('/api/v1/auth/recover',{email:owner.body.user.email,token:generated.body.recovery.token,password:next})).status,401);
  assert.equal((await request('/api/v1/auth/login',{email:owner.body.user.email,password})).status,401);
  assert.equal((await request('/api/v1/auth/login',{email:owner.body.user.email,password:next})).status,200);
});
