const drive = require('./drive-backup');

module.exports=function operationalStatus(db,env=process.env) {
  const temporary=env.LOCKGUARD_EPHEMERAL_DEMO==='true';
  const persistentConfigured=!temporary&&env.LOCKGUARD_DURABLE_STORAGE==='true';
  const lastRestoreVerifiedAt=db.getMeta('last_restore_verified_at')||null;
  const lastRestoreAttemptAt=db.getMeta('last_restore_attempt_at')||null;
  const lastRestoreFailureAt=db.getMeta('last_restore_failure_at')||null;
  const lastRestoreStatus=db.getMeta('last_restore_status');
  const now=Date.now(),recent=(value,age)=>{const timestamp=Date.parse(value);return Number.isFinite(timestamp)&&timestamp<=now&&now-timestamp<=age;};
  const restoreStatus=['failed','incomplete'].includes(lastRestoreStatus)?lastRestoreStatus:
    lastRestoreStatus&&lastRestoreStatus!=='ok'?'unknown':!lastRestoreVerifiedAt?'never':
      !Number.isFinite(Date.parse(lastRestoreVerifiedAt))||Date.parse(lastRestoreVerifiedAt)>now?'unknown':
        recent(lastRestoreVerifiedAt,7*86400000)?'ok':'overdue';
  const lastBackupAt=db.getMeta('last_backup_at')||null;
  const lastBackupAttemptAt=db.getMeta('last_backup_attempt_at')||null;
  const lastBackupFailureAt=db.getMeta('last_backup_failure_at')||null;
  const hours=Number(env.LOCKGUARD_BACKUP_HOURS||24);
  const maxAgeHours=Number(env.LOCKGUARD_BACKUP_MAX_AGE_HOURS||hours);
  const maxAge=Number.isFinite(hours)&&hours>=1&&Number.isFinite(maxAgeHours)&&maxAgeHours>=hours&&maxAgeHours<=8760?maxAgeHours*3600000:NaN;
  const backupStatus=db.getMeta('last_backup_status')==='failed'?'failed':!lastBackupAt?'never':!Number.isFinite(maxAge)||!Number.isFinite(Date.parse(lastBackupAt))||Date.parse(lastBackupAt)>now?'unknown':recent(lastBackupAt,maxAge)?'ok':'overdue';
  const driveBackup=drive.status(db,env,now,maxAge);
  const emailRecoveryConfigured=db.recovery.configured(env);
  return {storage:temporary?'temporary_demo':persistentConfigured?'persistent_configured':'local_unverified',
    persistentConfigured,lastBackupAt,lastBackupAttemptAt,lastBackupFailureAt,backupStatus,lastRestoreVerifiedAt,lastRestoreAttemptAt,lastRestoreFailureAt,restoreStatus,
    driveBackup,
    encryptedBackupsConfigured:!!env.LOCKGUARD_BACKUP_KEY,
    emailRecoveryConfigured,offlineRecoveryAvailable:true,
    emailVerificationConfigured:db.emailVerification.configured(env),emailOwnershipRequiredForInvitations:true,
    readyForPaidUse:persistentConfigured&&restoreStatus==='ok'&&backupStatus==='ok'&&driveBackup.status==='ok'&&emailRecoveryConfigured&&!!env.LOCKGUARD_BACKUP_KEY,
    notice:'Persistence is an operator declaration. A local backup on an ephemeral host does not protect against host restart. Keep an off-host backup and verify recovery.'};
};
