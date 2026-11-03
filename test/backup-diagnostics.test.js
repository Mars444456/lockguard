const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-backup-status-'));
process.env.LOCKGUARD_DB_FILE=path.join(directory,'source.sqlite3');process.env.NODE_ENV='test';delete process.env.LOCKGUARD_BACKUP_KEY;
const db=require('../src/server/db'),status=require('../src/server/operational-status');
test.after(()=>{delete process.env.LOCKGUARD_BACKUP_KEY;db.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^lockguard-backup-status-/);fs.rmSync(directory,{recursive:true,force:true});});
test('Backup diagnostics persist destination and encryption failures, then recover after a verified copy',async()=>{
  const blocked=path.join(directory,'blocked');fs.writeFileSync(blocked,'synthetic fixture');
  await assert.rejects(db.createBackup(blocked));
  let report=status(db,{});assert.equal(report.backupStatus,'failed');assert.ok(report.lastBackupAttemptAt);assert.ok(report.lastBackupFailureAt);assert.equal(report.lastBackupAt,null);
  assert.ok(!JSON.stringify(report).includes(directory));
  process.env.LOCKGUARD_BACKUP_KEY='invalid-test-key';
  await assert.rejects(db.createBackup(path.join(directory,'encrypted')));
  assert.equal(status(db,{}).backupStatus,'failed');assert.ok(!JSON.stringify(status(db,{})).includes('invalid-test-key'));
  delete process.env.LOCKGUARD_BACKUP_KEY;
  const file=await db.createBackup(path.join(directory,'valid'));
  assert.ok(fs.existsSync(file));report=status(db,{});assert.equal(report.backupStatus,'ok');assert.ok(report.lastBackupAt);assert.ok(report.lastBackupFailureAt,'Historical failure time remains available');
});
test('Failed, stale, future and missing backup evidence cannot report operational readiness',()=>{
  const at=age=>new Date(Date.now()-age).toISOString(),meta={last_backup_at:at(60000),last_restore_verified_at:at(60000),last_backup_status:'ok'};
  const fake={getMeta:key=>meta[key],recovery:{configured:()=>true},emailVerification:{configured:()=>true}};
  const env={LOCKGUARD_DURABLE_STORAGE:'true',LOCKGUARD_BACKUP_KEY:'test-only'};
  assert.equal(status(fake,env).backupStatus,'ok');
  for(const [value,expected] of [[at(25*3600000),'overdue'],[at(-3600000),'unknown'],['invalid','unknown'],['','never']]){
    meta.last_backup_at=value;const report=status(fake,env);assert.equal(report.backupStatus,expected);assert.equal(report.readyForPaidUse,false);
  }
  meta.last_backup_at=at(60000);meta.last_backup_status='failed';assert.equal(status(fake,env).readyForPaidUse,false);
  meta.last_backup_status='ok';meta.last_restore_verified_at=at(-60000);assert.equal(status(fake,env).readyForPaidUse,false);
  meta.last_backup_at=at(3*3600000);assert.equal(status(fake,{...env,LOCKGUARD_BACKUP_HOURS:'2'}).backupStatus,'overdue');
});
test('Scheduled backup failure logs do not expose the original error content',async()=>{
  const logs=[],original=console.error;console.error=(...args)=>logs.push(args.join(' '));let stop;
  try{
    stop=require('../src/server/backup-scheduler')({dbFilePath:path.join(directory,'unused.sqlite3'),getMeta:()=>null,createBackup:async()=>{throw new Error('private-path-and-key');}},{});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(logs.length,1);assert.match(logs[0],/backup failed/);assert.doesNotMatch(logs[0],/private-path-and-key/);
  }finally{stop?.();console.error=original;}
});
