const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-008',
  code: 'MISSING_LOCK_TIMEOUT',
  name: 'Missing SET lock_timeout directive in migration',
  severity: Severity.HIGH,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'Without SET lock_timeout, a blocked DDL statement queues up behind long-running queries, blocking ALL subsequent incoming client requests (Head-of-Line Blocking).',
  
  check(astStatements) {
    const violations = [];

    // Check if any statement alters schema (ALTER TABLE, CREATE INDEX, DROP TABLE, etc.)
    const hasDdl = astStatements.some(s => 
      s.type === 'ALTER_TABLE' || 
      s.type === 'CREATE_INDEX' || 
      s.type === 'DROP_TABLE'
    );

    if (!hasDdl) {
      return violations;
    }

    // Look for SET lock_timeout in the first few statements
    const hasLockTimeout = astStatements.some(s => 
      s.type === 'SET_VARIABLE' && s.variable === 'lock_timeout' && s.value
    );

    if (!hasLockTimeout) {
      violations.push({
        ruleId: this.id,
        ruleCode: this.code,
        ruleName: this.name,
        severity: Severity.HIGH,
        lockLevel: LockLevel.ACCESS_EXCLUSIVE,
        table: 'global',
        line: 1,
        raw: '-- (Header of migration file)',
        message: 'No `SET lock_timeout` found in migration! If table locks cannot be acquired immediately, this migration will block all production traffic behind it.'
      });
    }

    return violations;
  },

  generateSafeFix() {
    return [
      `-- Add this safeguard at the very top of your migration file:`,
      `SET lock_timeout = '3s';`,
      `SET statement_timeout = '30s';`
    ].join('\n');
  }
};
