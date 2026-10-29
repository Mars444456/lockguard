const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-007',
  code: 'UNSAFE_VACUUM_IN_TRANSACTION',
  name: 'VACUUM or autovacuum storage parameter changes inside migration transaction',
  severity: Severity.HIGH,
  lockLevel: LockLevel.SHARE_UPDATE_EXCLUSIVE,
  description: 'VACUUM cannot run inside a multi-statement transaction block. Modifying autovacuum settings inside a transaction can cause deadlock or transaction failure.',
  
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
          severity: Severity.CRITICAL,
          lockLevel: stmt.isFull ? LockLevel.ACCESS_EXCLUSIVE : LockLevel.SHARE_UPDATE_EXCLUSIVE,
          table: 'all',
          line: stmt.line,
          raw: stmt.raw,
          message: stmt.isFull 
            ? `VACUUM FULL locks tables completely (ACCESS EXCLUSIVE) and cannot be executed in standard migrations!`
            : `VACUUM statement found in migration script. VACUUM cannot run within an explicit transaction block!`
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
              raw: sub.raw,
              message: `Changing autovacuum settings (${sub.params}) on table '${sub.table}' inside migration script. Run outside migration transactions.`
            });
          }
        }
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const table = violation.table || 'your_table';
    return [
      `-- Run maintenance operations outside transactional migration scripts:`,
      `-- e.g. run via standalone DBA job or pg_cron:`,
      `ALTER TABLE ${table} SET (autovacuum_vacuum_scale_factor = 0.05);`
    ].join('\n');
  }
};
