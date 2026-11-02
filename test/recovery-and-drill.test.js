require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-recovery-'));
process.env.LOCKGUARD_DB_FILE=path.join(directory,'main.sqlite3');
const db=require('../src/server/db'),{PersistentDatabase}=db,{restore}=require('../scripts/restore-db'),{verifyRestore}=require('../scripts/verify-restore');
const status=require('../src/server/operational-status');
const {validate}=require('../scripts/durable-server');
const user=db.createAccount({email:'restore@example.invalid',passwordHash:'original-hash',organizationName:'Restore test'});
test.after(()=>{delete process.env.LOCKGUARD_BACKUP_KEY;db.close();fs.rmSync(directory,{recursive:true,force:true});});

test('Durable startup refuses a temporary or incomplete storage configuration',()=>{
  const env={APP_URL:'https://example.invalid',LOCKGUARD_DURABLE_STORAGE:'true',LOCKGUARD_DB_FILE:path.join(directory,'db.sqlite3'),LOCKGUARD_BACKUP_DIR:path.join(directory,'backups'),LOCKGUARD_BACKUP_KEY:'configured-at-runtime'};
  assert.doesNotThrow(()=>validate(env));
  for(const patch of [{LOCKGUARD_EPHEMERAL_DEMO:'true'},{LOCKGUARD_DURABLE_STORAGE:'false'},{APP_URL:'http://example.invalid'},{LOCKGUARD_DB_FILE:'relative.sqlite3'},{LOCKGUARD_BACKUP_KEY:''},{PORT:'invalid'}])assert.throws(()=>validate({...env,...patch}));
});

test('Recovery codes are hashed, bound to an account, rotated, one-use and revoke sessions',()=>{
  const session=db.createSession(user.id),first=db.recovery.issue(user.id),second=db.recovery.issue(user.id);
  assert.throws(()=>db.recovery.verify(user.email,first.token));
  assert.throws(()=>db.recovery.verify('different@example.invalid',second.token));
  assert.ok(!JSON.stringify(db.sql.prepare('SELECT * FROM recovery_tokens').all()).includes(second.token));
  const valid=db.recovery.verify(user.email,second.token);assert.equal(valid.id,user.id);
  db.recovery.consume(user.email,second.token,'new-hash','original-hash');
  assert.equal(db.getSession(session),null);assert.equal(db.getUserByEmail(user.email).passwordHash,'new-hash');
  assert.throws(()=>db.recovery.verify(user.email,second.token));
  const expired=db.recovery.issue(user.id);db.sql.prepare('UPDATE recovery_tokens SET expires_at=0').run();
  assert.throws(()=>db.recovery.verify(user.email,expired.token));
});

test('Email reset sends only through an explicitly configured provider and keeps tokens out of URL queries',async()=>{
  let request;
  const send=async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return {ok:true};};
  await assert.rejects(db.recovery.send(user.email,{},send),/не настроено/);
  const env={LOCKGUARD_MAIL_API_KEY:'unit-test-only',LOCKGUARD_MAIL_FROM:'LockGuard <test@example.invalid>',APP_URL:'https://example.invalid'};
  await db.recovery.send(user.email,env,send);
  assert.deepEqual(request.body.to,[user.email]);
  const link=new URL(request.body.text.split('\n').at(-1));assert.equal(link.search,'');assert.match(link.hash,/^#token=[a-f0-9]{64}$/);
  const code=link.hash.split('=')[1];assert.equal(db.recovery.verify(user.email,code).id,user.id);
  request=null;await db.recovery.send('unknown@example.invalid',env,send);assert.equal(request,null);
});

test('Encrypted backups restore records, reject wrong keys and remove temporary credentials',async()=>{
  process.env.LOCKGUARD_BACKUP_KEY=crypto.randomBytes(32).toString('base64');
  const originalKey=process.env.LOCKGUARD_BACKUP_KEY,owner={...user,role:'owner'},store=db.forOrganization(user.organizationId);
  store.updatePlan('team');store.addRun({findingsVersion:1,findings:[],analysisComplete:true,coverageComplete:true});
  const run=store.getRuns()[0],review=db.workspaces.createReview(owner,{title:'Restore review',runId:run.id});
  db.workspaces.invite(owner,{email:'new@example.invalid',role:'reviewer'});db.recovery.issue(user.id);db.createSession(user.id);
  const backup=await db.createBackup(path.join(directory,'backups'));assert.match(backup,/\.enc$/);
  assert.equal(fs.readFileSync(backup).subarray(0,8).toString(),'LGBACK01');
  const target=path.join(directory,'restored.sqlite3');
  process.env.LOCKGUARD_BACKUP_KEY=crypto.randomBytes(32).toString('base64');await assert.rejects(restore(backup,target),/authentication failed/);assert.equal(fs.existsSync(target),false);
  process.env.LOCKGUARD_BACKUP_KEY=originalKey;await restore(backup,target);
  const restored=new PersistentDatabase({dbFilePath:target});
  try {assert.equal(restored.workspaces.getReview(owner,review.id).title,'Restore review');assert.equal(restored.getUserByEmail(user.email).passwordHash,'new-hash');for(const table of ['sessions','recovery_tokens','workspace_invites'])assert.equal(restored.sql.prepare('SELECT count(*) AS n FROM '+table).get().n,0);}finally{restored.close();}
  const report=await verifyRestore(db,path.join(directory,'backups'));assert.ok(report.verifiedTables>5);assert.ok(db.getMeta('last_restore_verified_at'));
  assert.equal(status(db,{LOCKGUARD_EPHEMERAL_DEMO:'true',LOCKGUARD_DURABLE_STORAGE:'true'}).readyForPaidUse,false);
});
