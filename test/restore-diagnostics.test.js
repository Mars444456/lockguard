const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-restore-status-'));
process.env.LOCKGUARD_DB_FILE=path.join(directory,'source.sqlite3');process.env.NODE_ENV='test';
process.env.LOCKGUARD_BACKUP_KEY=crypto.randomBytes(32).toString('base64');
const db=require('../src/server/db'),status=require('../src/server/operational-status');
const backupCrypto=require('../src/server/backup-crypto'),{verifyRestore}=require('../scripts/verify-restore');
const backups=path.join(directory,'backups');
const readyEnv={LOCKGUARD_DURABLE_STORAGE:'true',LOCKGUARD_BACKUP_KEY:'test-only',LOCKGUARD_MAIL_API_KEY:'test-only',LOCKGUARD_MAIL_FROM:'test@example.invalid',APP_URL:'https://example.invalid'};
test.after(()=>{db.close();delete process.env.LOCKGUARD_BACKUP_KEY;assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^lockguard-restore-status-/);fs.rmSync(directory,{recursive:true,force:true});});

test('A failed restore after a successful copy revokes old readiness, persists, and recovers only after a full retry',async t=>{
  await verifyRestore(db,backups);
  assert.equal(status(db,readyEnv).readyForPaidUse,true);
  const previous=db.getMeta('last_restore_verified_at');
  const original=backupCrypto.plaintext;
  const failure=t.mock.method(backupCrypto,'plaintext',async()=>{throw new Error('private-path-key-sql@example.invalid');});
  const error=await verifyRestore(db,backups).then(()=>null,error=>error);
  assert.ok(error);
  const report=status(db,readyEnv);
  assert.equal(report.backupStatus,'ok','The new copy succeeded; failure is specific to restoring it');
  assert.equal(report.readyForPaidUse,false,'An earlier successful drill cannot hide the latest failure');
  assert.equal(report.restoreStatus,'failed');assert.ok(report.lastRestoreAttemptAt);assert.ok(report.lastRestoreFailureAt);
  assert.equal(report.lastRestoreVerifiedAt,previous);
  assert.doesNotMatch(error.message,/private-path-key|sql@example/);
  assert.doesNotMatch(JSON.stringify(report),/private-path-key|sql@example|source\.sqlite3/);
  const reopened=new db.PersistentDatabase({dbFilePath:db.dbFilePath});
  try{assert.equal(status(reopened,readyEnv).restoreStatus,'failed');assert.equal(status(reopened,readyEnv).readyForPaidUse,false);}finally{reopened.close();}
  failure.mock.restore();assert.equal(backupCrypto.plaintext,original);
  await verifyRestore(db,backups);
  const recovered=status(db,readyEnv);
  assert.equal(recovered.restoreStatus,'ok');assert.equal(recovered.readyForPaidUse,true);
  assert.equal(recovered.lastRestoreFailureAt,report.lastRestoreFailureAt);
});

test('Preparation and cleanup failures both count as failed restore drills without leaking their errors',async t=>{
  for(const stage of ['preparation','cleanup']){
    await verifyRestore(db,backups);const previous=db.getMeta('last_restore_verified_at');
    const name=stage==='preparation'?'mkdtempSync':'rmSync',original=fs[name];let leftover;
    const failure=t.mock.method(fs,name,(file,...args)=>{
      if(path.basename(file).startsWith('lockguard-restore-drill-')){if(stage==='cleanup')leftover=file;throw new Error('private-restore-path-key');}
      return original(file,...args);
    });
    let error;
    try{error=await verifyRestore(db,backups).then(()=>null,error=>error);}finally{
      failure.mock.restore();
      if(leftover){assert.equal(path.dirname(path.resolve(leftover)),path.resolve(os.tmpdir()));assert.match(path.basename(leftover),/^lockguard-restore-drill-/);fs.rmSync(leftover,{recursive:true,force:true});}
    }
    assert.ok(error);assert.doesNotMatch(error.message,/private-restore-path-key/);
    assert.equal(status(db,readyEnv).restoreStatus,'failed');assert.equal(status(db,readyEnv).readyForPaidUse,false);
    assert.equal(db.getMeta('last_restore_verified_at'),previous,'Success is recorded only after cleanup');
  }
});

test('Incomplete, stale, future and invalid restore evidence does not establish readiness',()=>{
  const now=Date.now(),at=age=>new Date(now-age).toISOString();
  const meta={last_backup_at:at(1000),last_backup_status:'ok',last_restore_verified_at:at(1000),last_restore_status:'ok'};
  const fake={getMeta:key=>meta[key],recovery:{configured:()=>true},emailVerification:{configured:()=>true}};
  assert.equal(status(fake,readyEnv).readyForPaidUse,true);
  for(const state of ['failed','incomplete','unexpected']){meta.last_restore_status=state;assert.equal(status(fake,readyEnv).readyForPaidUse,false);}
  meta.last_restore_status='ok';
  for(const [value,expected] of [[at(8*86400000),'overdue'],[at(-60000),'unknown'],['invalid','unknown'],['','never']]){
    meta.last_restore_verified_at=value;assert.equal(status(fake,readyEnv).restoreStatus,expected);assert.equal(status(fake,readyEnv).readyForPaidUse,false);
  }
});

test('The restore CLI returns a failure and records it without printing the private storage path',()=>{
  const blocked=path.join(directory,'private-key-sql@example.invalid');fs.writeFileSync(blocked,'synthetic fixture');
  const childDb=path.join(directory,'cli.sqlite3');
  const result=spawnSync(process.execPath,['--no-warnings',path.join(__dirname,'../scripts/verify-restore.js')],{
    env:{...process.env,LOCKGUARD_DB_FILE:childDb,LOCKGUARD_BACKUP_DIR:blocked},encoding:'utf8',timeout:30000
  });
  assert.equal(result.status,1);assert.match(result.stderr,/Restore verification failed/);
  assert.doesNotMatch(result.stdout+result.stderr,/private-key-sql|example\.invalid|cli\.sqlite3/);
  const reopened=new db.PersistentDatabase({dbFilePath:childDb});
  try{const report=status(reopened,readyEnv);assert.equal(report.restoreStatus,'failed');assert.ok(report.lastRestoreAttemptAt);assert.ok(report.lastRestoreFailureAt);assert.equal(report.readyForPaidUse,false);}finally{reopened.close();}
});

test('Offline verification restores the supplied encrypted file without opening the configured database',async()=>{
  const file=await db.createBackup(backups);
  const receivedDirectory=path.join(directory,'received backups');
  fs.mkdirSync(receivedDirectory);
  const received=path.join(receivedDirectory,'received.sqlite3.enc');
  fs.copyFileSync(file,received);
  const configuredDatabase=path.join(directory,'unused-live.sqlite3');
  const run=spawnSync(process.execPath,['--no-warnings',path.join(__dirname,'../scripts/verify-restore.js'),'--from',received],{
    env:{...process.env,LOCKGUARD_DB_FILE:configuredDatabase},encoding:'utf8',timeout:30000
  });
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(run.stdout);
  assert.equal(report.source,'provided_encrypted_file');
  assert.equal(report.temporaryCredentialsRevoked,true);
  assert.ok(report.verifiedTables>0);
  assert.equal(fs.existsSync(configuredDatabase),false);
  assert.deepEqual(fs.readFileSync(received),fs.readFileSync(file));
  assert.ok(!run.stdout.includes(directory));
});

test('Offline verification rejects an unencrypted snapshot even when the name has no encrypted suffix',async()=>{
  const originalKey=process.env.LOCKGUARD_BACKUP_KEY;
  let plaintext;
  try {
    delete process.env.LOCKGUARD_BACKUP_KEY;
    plaintext=await db.createBackup(path.join(directory,'local-plaintext'));
  } finally { process.env.LOCKGUARD_BACKUP_KEY=originalKey; }
  const configuredDatabase=path.join(directory,'unused-invalid-live.sqlite3');
  const run=spawnSync(process.execPath,['--no-warnings',path.join(__dirname,'../scripts/verify-restore.js'),'--from',plaintext],{
    env:{...process.env,LOCKGUARD_DB_FILE:configuredDatabase},encoding:'utf8',timeout:30000
  });
  assert.equal(run.status,1);
  assert.match(run.stderr,/Restore verification failed/);
  assert.equal(fs.existsSync(configuredDatabase),false);
  assert.doesNotMatch(run.stdout+run.stderr,/local-plaintext|unused-invalid-live/);
});
