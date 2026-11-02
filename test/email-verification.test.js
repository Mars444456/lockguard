const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-email-proof-'));
process.env.LOCKGUARD_DB_FILE=path.join(directory,'email.sqlite3');
const db=require('../src/server/db'),mail=require('../src/server/mail-service');
const service=db.emailVerification;
const user=name=>db.createAccount({email:name+'@example.invalid',passwordHash:'hash-'+name,organizationName:name});
const env={APP_URL:'https://lockguard.example.invalid/',LOCKGUARD_MAIL_FROM:'LockGuard <mail@example.invalid>',LOCKGUARD_MAIL_API_KEY:'test-only'};
test.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});

test('Existing and new accounts remain unverified; tokens are hashed, account-bound, expiring and single-use',()=>{
  const a=user('proof-a'),b=user('proof-b');assert.equal(service.state(a.id).emailVerified,false);
  const first=service.issue(a.id),row=db.sql.prepare('SELECT * FROM email_verification_tokens WHERE user_id=?').get(a.id);
  assert.notEqual(row.token_hash,first.token);assert.doesNotMatch(JSON.stringify(row),new RegExp(first.token));
  assert.throws(()=>service.consume(b.id,first.token),/недействительна/);
  const result=service.consume(a.id,first.token);assert.equal(result.emailVerified,true);assert.ok(result.emailVerifiedAt);
  assert.throws(()=>service.consume(a.id,first.token),/недействительна/);
  const expired=service.issue(b.id);db.sql.prepare('UPDATE email_verification_tokens SET expires_at=0 WHERE user_id=?').run(b.id);
  assert.throws(()=>service.consume(b.id,expired.token),/истекла/);
});

test('A resend revokes the previous link; password changes revoke pending links without inventing verification',()=>{
  const a=user('proof-password'),old=service.issue(a.id),next=service.issue(a.id);
  assert.throws(()=>service.consume(a.id,old.token));db.changePassword(a.id,'replacement-hash','hash-proof-password');
  assert.throws(()=>service.consume(a.id,next.token));assert.equal(service.state(a.id).emailVerified,false);
});

test('Provider acceptance is explicit, links use the configured origin and raw tokens never enter the response',async()=>{
  const a=user('proof-send');let payload;
  const sent=await service.send(a.id,env,async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');payload=JSON.parse(options.body);return new Response('{}');});
  assert.equal(sent.acceptedByProvider,true);assert.equal(service.state(a.id).emailVerified,false);
  assert.deepEqual(payload.to,[a.email]);const link=new URL(payload.text.match(/https:\/\/\S+/)[0]);
  assert.equal(link.origin,'https://lockguard.example.invalid');assert.equal(link.pathname,'/verify-email.html');assert.equal(link.search,'');
  const token=new URLSearchParams(link.hash.slice(1)).get('token');assert.match(token,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(sent).includes(token));
  await assert.rejects(service.send(a.id,env,async()=>{throw new Error('Must not call provider twice');}),error=>error.statusCode===429);
  service.consume(a.id,token);assert.equal(service.state(a.id).emailVerified,true);
});

test('Unavailable or failed mail delivery never marks email verified or exposes provider details',async()=>{
  const a=user('proof-failure');
  await assert.rejects(service.send(a.id,{}),error=>error.statusCode===503&&error.code==='MAIL_UNAVAILABLE');
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM email_verification_tokens WHERE user_id=?').get(a.id).n,0);
  await assert.rejects(service.send(a.id,env,async()=>new Response('secret provider details',{status:500})),error=>error.code==='MAIL_DELIVERY_FAILED'&&!error.message.includes('secret'));
  assert.equal(service.state(a.id).emailVerified,false);assert.equal(db.sql.prepare('SELECT count(*) AS n FROM email_verification_tokens WHERE user_id=?').get(a.id).n,0);
  assert.equal(mail.configured({...env,APP_URL:'https://user:password@example.invalid/'}),false);
  assert.equal(mail.configured({...env,APP_URL:'http://localhost/',NODE_ENV:'production'}),false);
});

test('Unverified inviters and invitees are rejected, client flags cannot bypass proof, old sessions fall back to their own workspace',()=>{
  const a=user('proof-owner'),b=user('proof-member');db.forOrganization(a.organizationId).updatePlan('team');
  assert.throws(()=>db.workspaces.invite({...a,emailVerified:true},{email:b.email,role:'reviewer'}),error=>error.code==='EMAIL_VERIFICATION_REQUIRED');
  service.consume(a.id,service.issue(a.id).token);
  const invite=db.workspaces.invite(a,{email:b.email,role:'reviewer'});
  assert.throws(()=>db.workspaces.accept({...b,emailVerified:true},invite.token),error=>error.code==='EMAIL_VERIFICATION_REQUIRED');
  service.consume(b.id,service.issue(b.id).token);assert.equal(db.workspaces.accept(b,invite.token),a.organizationId);
  const token=db.createSession(b.id);db.workspaces.select(b,token,a.organizationId);assert.equal(db.getSession(token).organizationId,a.organizationId);
  db.sql.prepare('DELETE FROM email_verification_state WHERE user_id=?').run(b.id);
  assert.equal(db.getSession(token).organizationId,b.organizationId);assert.throws(()=>db.workspaces.select(b,token,a.organizationId),error=>error.code==='EMAIL_VERIFICATION_REQUIRED');
});

test('Only email recovery proves mailbox ownership; offline recovery does not',()=>{
  for(const kind of ['offline','email']){
    const a=user('proof-recovery-'+kind),token=db.recovery.issue(a.id,kind);
    db.recovery.consume(a.email,token.token,'new-hash','hash-proof-recovery-'+kind);
    assert.equal(service.state(a.id).emailVerified,kind==='email');
  }
});

test('Short login windows cannot reset the daily email-delivery budget',t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  assert.equal(db.allowAuthAttempt('daily-mail-proof',1,86400000),true);
  now+=16*60000;assert.equal(db.allowAuthAttempt('short-login-proof',10,15*60000),true);
  assert.equal(db.allowAuthAttempt('daily-mail-proof',1,86400000),false);
  now+=86400000;assert.equal(db.allowAuthAttempt('daily-mail-proof',1,86400000),true);
});
