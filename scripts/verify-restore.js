const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {restore}=require('./restore-db');

async function verifyRestore(db,directory) {
  const file=await db.createBackup(directory),temp=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-restore-drill-'));
  let source,target,readable;
  try {
    const restored=await restore(file,path.join(temp,'restored.sqlite3'));
    readable=await require('../src/server/backup-crypto').plaintext(file);
    source=new DatabaseSync(readable.file,{readOnly:true});target=new DatabaseSync(restored,{readOnly:true});
    const excluded=['metadata','sessions','session_workspaces','auth_limits','workspace_invites','recovery_tokens','email_verification_tokens'];
    const tables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name).filter(name=>!excluded.includes(name));
    for(const name of tables) {
      if(!/^[a-z_]+$/.test(name))throw new Error('Unexpected backup table');
      const checksum=connection=>crypto.createHash('sha256').update(JSON.stringify(connection.prepare('SELECT * FROM '+name).all().map(row=>JSON.stringify(row)).sort())).digest('hex');
      if(checksum(source)!==checksum(target))throw new Error('Restored records differ from the verified backup');
    }
    for(const name of ['sessions','recovery_tokens','workspace_invites','email_verification_tokens']) {
      if(target.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)&&target.prepare('SELECT count(*) AS n FROM '+name).get().n!==0)throw new Error('Restore retained temporary credentials');
    }
    const at=new Date().toISOString();db.setMeta('last_restore_verified_at',at);
    return {verifiedAt:at,verifiedTables:tables.length,sessionsRevoked:true,temporaryCredentialsRevoked:true};
  } finally {
    source?.close();target?.close();
    readable?.cleanup();
    const resolved=path.resolve(temp);
    if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('lockguard-restore-drill-'))throw new Error('Invalid drill cleanup directory');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
if(require.main===module){const db=require('../src/server/db');verifyRestore(db,process.env.LOCKGUARD_BACKUP_DIR).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error('Restore verification failed: '+error.message);process.exitCode=1;}).finally(()=>db.close());}
module.exports={verifyRestore};
