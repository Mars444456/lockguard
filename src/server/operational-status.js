module.exports=function operationalStatus(db,env=process.env) {
  const temporary=env.LOCKGUARD_EPHEMERAL_DEMO==='true';
  const persistentConfigured=!temporary&&env.LOCKGUARD_DURABLE_STORAGE==='true';
  const lastRestoreVerifiedAt=db.getMeta('last_restore_verified_at')||null;
  const restoreRecent=!!lastRestoreVerifiedAt&&Date.now()-Date.parse(lastRestoreVerifiedAt)<7*86400000;
  return {storage:temporary?'temporary_demo':persistentConfigured?'persistent_configured':'local_unverified',
    persistentConfigured,lastBackupAt:db.getMeta('last_backup_at')||null,lastRestoreVerifiedAt,
    encryptedBackupsConfigured:!!env.LOCKGUARD_BACKUP_KEY,
    emailRecoveryConfigured:db.recovery.configured(env),offlineRecoveryAvailable:true,
    emailVerificationConfigured:db.emailVerification.configured(env),emailOwnershipRequiredForInvitations:true,
    readyForPaidUse:persistentConfigured&&restoreRecent&&db.recovery.configured(env)&&!!env.LOCKGUARD_BACKUP_KEY,
    notice:'Persistence is an operator declaration. A local backup on an ephemeral host does not protect against host restart. Keep an off-host backup and verify recovery.'};
};
