module.exports=function operationalStatus(db,env=process.env) {
  const temporary=env.LOCKGUARD_EPHEMERAL_DEMO==='true';
  const persistentConfigured=!temporary&&env.LOCKGUARD_DURABLE_STORAGE==='true';
  const lastRestoreVerifiedAt=db.getMeta('last_restore_verified_at')||null;
  const now=Date.now(),recent=(value,age)=>{const timestamp=Date.parse(value);return Number.isFinite(timestamp)&&timestamp<=now&&now-timestamp<=age;};
  const restoreRecent=recent(lastRestoreVerifiedAt,7*86400000);
  const lastBackupAt=db.getMeta('last_backup_at')||null;
  const lastBackupAttemptAt=db.getMeta('last_backup_attempt_at')||null;
  const lastBackupFailureAt=db.getMeta('last_backup_failure_at')||null;
  const hours=Number(env.LOCKGUARD_BACKUP_HOURS||24),intervalValid=Number.isFinite(hours)&&hours>=1&&hours<=8760;
  const backupRecent=intervalValid&&recent(lastBackupAt,hours*3600000);
  const backupStatus=db.getMeta('last_backup_status')==='failed'?'failed':!lastBackupAt?'never':!intervalValid||!Number.isFinite(Date.parse(lastBackupAt))||Date.parse(lastBackupAt)>now?'unknown':backupRecent?'ok':'overdue';
  return {storage:temporary?'temporary_demo':persistentConfigured?'persistent_configured':'local_unverified',
    persistentConfigured,lastBackupAt,lastBackupAttemptAt,lastBackupFailureAt,backupStatus,lastRestoreVerifiedAt,
    encryptedBackupsConfigured:!!env.LOCKGUARD_BACKUP_KEY,
    emailRecoveryConfigured:db.recovery.configured(env),offlineRecoveryAvailable:true,
    emailVerificationConfigured:db.emailVerification.configured(env),emailOwnershipRequiredForInvitations:true,
    readyForPaidUse:persistentConfigured&&restoreRecent&&backupStatus==='ok'&&db.recovery.configured(env)&&!!env.LOCKGUARD_BACKUP_KEY,
    notice:'Persistence is an operator declaration. A local backup on an ephemeral host does not protect against host restart. Keep an off-host backup and verify recovery.'};
};
