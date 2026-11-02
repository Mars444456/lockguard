// Use only with an operator-provided persistent volume and separately retained backups.
const path=require('node:path');
function validate(env) {
  const port=Number(env.PORT||3000);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be an integer from 1024 to 65535.');
  if(env.LOCKGUARD_EPHEMERAL_DEMO==='true'||env.LOCKGUARD_DURABLE_STORAGE!=='true')throw new Error('Declare a mounted persistent volume with LOCKGUARD_DURABLE_STORAGE=true; the temporary cloud demo is not supported.');
  for(const name of ['LOCKGUARD_DB_FILE','LOCKGUARD_BACKUP_DIR'])if(!env[name]||!path.isAbsolute(env[name]))throw new Error(name+' must be an absolute path on configured storage.');
  const origin=new URL(env.APP_URL);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('APP_URL must be the HTTPS application origin.');
  if(!env.LOCKGUARD_BACKUP_KEY)throw new Error('Configure LOCKGUARD_BACKUP_KEY separately from backup storage.');
}
async function start() {
  validate(process.env);process.env.NODE_ENV='production';
  const db=require('../src/server/db');
  try {await require('./verify-restore').verifyRestore(db,process.env.LOCKGUARD_BACKUP_DIR);}catch(error){db.close();throw error;}
  const server=require('../src/server/server'),stopBackups=require('../src/server/backup-scheduler')(db);
  const stop=()=>{stopBackups();server.close(()=>{db.close();process.exit(0);});server.closeIdleConnections();setTimeout(()=>process.exit(1),8000).unref();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  server.once('error',()=>{stopBackups();db.close();process.exitCode=1;});
  server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('LockGuard started after a verified encrypted restore drill. Persistent storage remains the operator’s responsibility.'));
}
if(require.main===module)start().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={validate};
