require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-workspace-'));
process.env.LOCKGUARD_DB_FILE=path.join(directory,'workspace.sqlite3');
const db=require('../src/server/db'),{digest}=require('../src/server/workspace-service');
const create=(name)=>{const u=db.createAccount({email:name+'@example.invalid',passwordHash:'test',organizationName:name});db.emailVerification.consume(u.id,db.emailVerification.issue(u.id).token);const token=db.createSession(u.id);return {...db.getSession(token),token};};
const owner=create('owner'),reviewer=create('reviewer'),stranger=create('stranger');
const service=db.workspaces,store=db.forOrganization(owner.organizationId);
store.updatePlan('team');
let invite,review;
test.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});

test('Invites are bound to email, stored as hashes, single use and do not replace personal ownership',()=>{
  invite=service.invite(owner,{email:reviewer.email,role:'reviewer'});
  assert.equal(db.sql.prepare('SELECT token_hash FROM workspace_invites WHERE id=?').get(invite.id).token_hash,digest(invite.token));
  assert.throws(()=>service.accept(stranger,invite.token),/недействительно/);
  assert.equal(service.accept(reviewer,invite.token),owner.organizationId);
  assert.throws(()=>service.accept(reviewer,invite.token));
  service.select(reviewer,reviewer.token,owner.organizationId);
  const member=db.getSession(reviewer.token);assert.equal(member.role,'reviewer');assert.equal(member.organizationId,owner.organizationId);
  assert.equal(service.list(member).length,2);
  assert.throws(()=>service.invite(member,{email:stranger.email,role:'editor'}),/владельца/);
  assert.throws(()=>service.select(stranger,stranger.token,owner.organizationId));
  const cancelled=service.invite(owner,{email:stranger.email,role:'editor'});
  assert.ok(service.invitations(owner).some(i=>i.id===cancelled.id));
  service.revokeInvitation(owner,cancelled.id);assert.throws(()=>service.accept(stranger,cancelled.token));
});

test('Review cards keep an immutable source and finding snapshot, scoped to their organization',()=>{
  const sql="SET lock_timeout='3s'; CREATE INDEX CONCURRENTLY ix ON customers(id);";
  const run=store.addRun({sqlHash:digest(sql),findingsVersion:1,analysisComplete:true,coverageComplete:true,findings:[],schemaRevision:'abc',pgVersion:17});
  const partial=store.addRun({findingsVersion:1,analysisComplete:true,coverageComplete:false,findings:[]});
  assert.throws(()=>service.createReview(owner,{title:'Excluded checks',runId:partial.id}),/полная проверка/);
  const old=store.addRun({findingsVersion:1,analysisComplete:true,findings:[]});
  assert.throws(()=>service.createReview(owner,{title:'Unknown coverage',runId:old.id}),/полная проверка/);
  assert.throws(()=>service.createReview(owner,{title:'wrong SQL',runId:run.id,sql:'SELECT 1;'}));
  review=service.createReview(owner,{title:'Customer migration',runId:run.id,sql});
  assert.equal(review.sql,sql);assert.equal(review.run.schemaRevision,'abc');
  assert.throws(()=>service.getReview(stranger,review.id),/не найдено/);
  assert.throws(()=>service.createReview(db.getSession(reviewer.token),{title:'not allowed',runId:run.id}));
  store.clearRuns();assert.equal(service.getReview(owner,review.id).run.id,run.id);
});

test('Approval requires independent review and attestations; stale updates and expired Pro cannot mutate cards',()=>{
  let current=service.getReview(owner,review.id);const member=db.getSession(reviewer.token);
  assert.throws(()=>service.event(owner,review.id,{kind:'approve',expectedRevision:current.revision,text:'self'}),/независимый/);
  for(const check of ['schemaFresh','backfillVerified','applicationCompatible','stagingVerified'])current=service.event(owner,review.id,{kind:'attest',check,value:true,expectedRevision:current.revision});
  assert.throws(()=>service.event(owner,review.id,{kind:'comment',text:'stale',expectedRevision:1}),/изменилось/);
  current=service.event(owner,review.id,{kind:'submit',expectedRevision:current.revision});
  current=service.event(member,review.id,{kind:'approve',expectedRevision:current.revision,text:'Verified on staging.'});
  assert.equal(current.status,'approved');assert.equal(current.events.at(-1).actorId,member.id);
  store.updatePlan('free');
  assert.ok(service.getReview(member,review.id));
  assert.throws(()=>service.event(member,review.id,{kind:'comment',text:'expired',expectedRevision:current.revision}),/Pro/);
  store.updatePlan('team');
});

test('High findings require reasoned, time-limited waivers; removal immediately revokes workspace access',()=>{
  const run=store.addRun({findingsVersion:1,analysisComplete:true,coverageComplete:true,findings:[{ruleId:'LG-004',severity:'CRITICAL',table:'customers'}]});
  let card=service.createReview(owner,{title:'Type conversion',runId:run.id}),member=db.getSession(reviewer.token);
  for(const check of ['schemaFresh','backfillVerified','applicationCompatible','stagingVerified'])card=service.event(owner,card.id,{kind:'attest',check,value:true,expectedRevision:card.revision});
  card=service.event(owner,card.id,{kind:'submit',expectedRevision:card.revision});
  assert.throws(()=>service.event(member,card.id,{kind:'approve',text:'ok',expectedRevision:card.revision}),/риски/);
  card=service.event(owner,card.id,{kind:'waive',findingIndex:0,text:'Scheduled maintenance approved; data verified.',expiresAt:new Date(Date.now()+86400000).toISOString(),expectedRevision:card.revision});
  card=service.event(owner,card.id,{kind:'submit',expectedRevision:card.revision});
  assert.equal(service.event(member,card.id,{kind:'approve',text:'Independent verification',expectedRevision:card.revision}).status,'approved');
  service.remove(owner,reviewer.id);
  assert.throws(()=>service.event(member,card.id,{kind:'comment',text:'revoked',expectedRevision:card.revision}),/отозван/);
  assert.equal(db.getSession(reviewer.token).organizationId,reviewer.organizationId);
  assert.throws(()=>service.getReview(db.getSession(reviewer.token),card.id));
  assert.throws(()=>service.remove(owner,owner.id));
});
