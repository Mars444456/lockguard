const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-007',
  code: 'UNSAFE_VACUUM_IN_TRANSACTION',
  name: 'VACUUM or autovacuum storage parameter changes inside migration transaction',
  severity: Severity.HIGH,
  lockLevel: LockLevel.SHARE_UPDATE_EXCLUSIVE,
  description: 'VACUUM cannot run inside an explicit transaction block. VACUUM FULL requires ACCESS EXCLUSIVE. Autovacuum settings need workload review and can be changed in a transaction.',
  
  check(astStatements) {
    const violations = [];
    let inTransaction = false;

    for (const stmt of astStatements) {
      if (stmt.type === 'TRANSACTION_START') {
        inTransaction = true;
      }
      if (stmt.type === 'TRANSACTION_COMMIT') {
        inTransaction = false;
      }

      if (stmt.type === 'VACUUM') {
        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: stmt.isFull || inTransaction ? Severity.CRITICAL : Severity.MEDIUM,
          operationType: 'VACUUM',
          lockLevel: stmt.isFull ? LockLevel.ACCESS_EXCLUSIVE : LockLevel.SHARE_UPDATE_EXCLUSIVE,
          table: 'all',
          line: stmt.line,
          sourceStart: stmt.sourceStart,
          raw: stmt.raw,
          message: stmt.isFull 
            ? `VACUUM FULL locks tables completely (ACCESS EXCLUSIVE) and cannot be executed in standard migrations!`
            : inTransaction ? 'VACUUM inside an explicit transaction block will fail.' : 'VACUUM is outside an explicit transaction. Verify that the migration runner does not wrap it in a transaction and review maintenance load.'
        });
      }

      if (stmt.type === 'ALTER_TABLE' && stmt.subcommands) {
        for (const sub of stmt.subcommands) {
          if (sub.subtype === 'SET_STORAGE_PARAM' && /autovacuum/i.test(sub.params)) {
            violations.push({
              ruleId: this.id,
              ruleCode: this.code,
              ruleName: this.name,
              severity: Severity.MEDIUM,
              lockLevel: LockLevel.SHARE_UPDATE_EXCLUSIVE,
              table: sub.table,
              line: stmt.line,
              sourceStart: stmt.sourceStart,
              raw: sub.raw,
              operationType: 'AUTOVACUUM_SETTINGS',
              message: `Changing autovacuum settings on '${sub.table}' needs workload review. This ALTER is permitted inside a transaction; lock acquisition and transaction duration still matter.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    return [
      violation.operationType === 'VACUUM' ? '-- Run the original VACUUM in a standalone maintenance job without an explicit transaction.' : '-- Review the original autovacuum settings against observed vacuum progress, dead tuples and I/O load.',
      '-- No workload-specific parameter values can be inferred from this SQL alone.'
    ].join('\n');
  }
};
