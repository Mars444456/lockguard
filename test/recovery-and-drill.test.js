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
  db.emailVerification.consume(user.id,db.emailVerification.issue(user.id).token);
  store.updatePlan('team');store.addRun({findingsVersion:1,findings:[],analysisComplete:true,coverageComplete:true});
  const run=store.getRuns()[0],review=db.workspaces.createReview(owner,{title:'Restore review',runId:run.id});
  db.workspaces.invite(owner,{email:'new@example.invalid',role:'reviewer'});db.recovery.issue(user.id);db.createSession(user.id);db.emailVerification.issue(user.id);
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

test('Encrypted backup publication keeps plaintext outside the export directory and cleans failed output',async t=>{
  process.env.LOCKGUARD_BACKUP_KEY=crypto.randomBytes(32).toString('base64');
  const folder=path.join(directory,'encrypted-export');
  const encryption=require('../src/server/backup-crypto');
  const encrypt=encryption.encrypt;
  let snapshot, published;
  t.mock.method(encryption,'encrypt',async(source,target,secret)=>{
    snapshot=source;
    assert.ok(!path.resolve(source).startsWith(path.resolve(folder)+path.sep));
    assert.deepEqual(fs.readdirSync(folder),published?[path.basename(published)]:[]);
    return encrypt(source,target,secret);
  });
  published=await db.createBackup(folder);
  assert.match(published,/\.sqlite3\.enc$/);
  assert.deepEqual(fs.readdirSync(folder),[path.basename(published)]);
  assert.equal(fs.existsSync(snapshot),false);

  const rename=fs.renameSync;
  t.mock.method(fs,'renameSync',(source,target)=>{
    if (path.dirname(target)===folder) throw new Error('Synthetic publication failure');
    return rename(source,target);
  });
  await assert.rejects(db.createBackup(folder),/Synthetic publication failure/);
  assert.deepEqual(fs.readdirSync(folder),[path.basename(published)]);
  assert.equal(fs.existsSync(snapshot),false);
  await assert.rejects(db.createBackup(os.tmpdir()),/separate from the system temporary directory/);
});

test('Restore rejects a plaintext database substituted for an encrypted backup',async()=>{
  delete process.env.LOCKGUARD_BACKUP_KEY;
  const legacy=await db.createBackup(path.join(directory,'legacy-export'));
  const substituted=legacy+'.enc',target=path.join(directory,'substituted.sqlite3');
  fs.copyFileSync(legacy,substituted);
  process.env.LOCKGUARD_BACKUP_KEY=crypto.randomBytes(32).toString('base64');
  await assert.rejects(restore(substituted,target),/encrypted backup header/i);
  assert.equal(fs.existsSync(target),false);
  const legacyTarget=path.join(directory,'legacy-restored.sqlite3');
  await restore(legacy,legacyTarget);
  assert.equal(fs.existsSync(legacyTarget),true);
});

test('Restore can retry after credential cleanup fails without publishing the old sessions',async t=>{
  const {DatabaseSync}=require('node:sqlite');
  const token=db.createSession(user.id);
  const source=await db.createBackup(path.join(directory,'restore-retry-backups'));
  const destination=path.join(directory,'restore-retry');
  const target=path.join(destination,'restored.sqlite3');
  const exec=DatabaseSync.prototype.exec;
  let targetWasVisible;
  const fault=t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if (sql.includes('DELETE FROM sessions')) {
      targetWasVisible=fs.existsSync(target);
      throw new Error('Synthetic credential cleanup failure');
    }
    return exec.call(this,sql);
  });
  await assert.rejects(restore(source,target),/Synthetic credential cleanup failure/);
  assert.equal(targetWasVisible,false);
  assert.deepEqual(fs.readdirSync(destination),[]);
  assert.equal(db.getSession(token).id,user.id);

  fault.mock.restore();
  await restore(source,target);
  const restored=new PersistentDatabase({dbFilePath:target});
  try {
    assert.equal(restored.getSession(token),null);
    assert.equal(restored.getUserByEmail(user.email).id,user.id);
  } finally { restored.close(); }
});

test('Restore leaves an existing rollback journal untouched',async()=>{
  const source=await db.createBackup(path.join(directory,'journal-check-backups'));
  const target=path.join(directory,'journal-conflict.sqlite3');
  const journal=target+'-journal';
  const original=Buffer.from('Synthetic pre-existing journal');
  fs.writeFileSync(journal,original,{flag:'wx'});
  await assert.rejects(restore(source,target),/new path/);
  assert.equal(fs.existsSync(target),false);
  assert.deepEqual(fs.readFileSync(journal),original);
});

test('Concurrent restores publish a single complete database at the requested path',async()=>{
  const source=await db.createBackup(path.join(directory,'concurrent-restore-backups'));
  const destination=path.join(directory,'concurrent-restore');
  const target=path.join(destination,'restored.sqlite3');
  const attempts=await Promise.allSettled([restore(source,target),restore(source,target)]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.match(attempts.find(result=>result.status==='rejected').reason.message,/new path|EEXIST/);
  assert.deepEqual(fs.readdirSync(destination),[path.basename(target)]);
  const restored=new PersistentDatabase({dbFilePath:target});
  try {
    assert.equal(restored.getUserByEmail(user.email).id,user.id);
    assert.equal(restored.sql.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
  } finally { restored.close(); }
});
