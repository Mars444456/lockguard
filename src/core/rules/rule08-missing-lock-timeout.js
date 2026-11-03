const { Severity } = require('../types');
const statementLock = require('../statement-lock');

module.exports = {
  id: 'LG-008',
  code: 'MISSING_LOCK_TIMEOUT',
  name: 'Missing SET lock_timeout directive in migration',
  severity: Severity.HIGH,
  lockLevel: null,
  description: 'Without an effective positive lock_timeout, waiting DDL may queue later conflicting requests on the same relation. Impact depends on lock mode, transaction lifetime and workload.',
  
  check(astStatements, context = {}) {
    const violations = [];

    // Check if any statement alters schema (ALTER TABLE, CREATE INDEX, DROP TABLE, etc.)
    const hasDdl = astStatements.some(s => 
      s.type === 'ALTER_TABLE' || 
      s.type === 'CREATE_INDEX' || 
      s.type === 'DROP_TABLE' ||
      s.type === 'CREATE_TABLE' ||
      s.type === 'DROP_INDEX' ||
      s.type === 'TRUNCATE_TABLE' ||
      s.type === 'REFRESH_MATVIEW'
    );

    if (!hasDdl) {
      return violations;
    }

    // Evaluate the setting at each DDL, respecting order and transaction scope.
    let sessionTimeout = false;
    let localTimeout;
    let transactionStart = context.transactionWrapped ? sessionTimeout : undefined;
    let unsafeStatement;
    const ddlTypes = new Set(['ALTER_TABLE', 'CREATE_INDEX', 'DROP_TABLE', 'CREATE_TABLE', 'DROP_INDEX', 'TRUNCATE_TABLE', 'REFRESH_MATVIEW']);
    for (const stmt of astStatements) {
      if (stmt.type === 'TRANSACTION_START') {
        // PostgreSQL warns on a nested BEGIN; it does not start a new transaction.
        if (transactionStart === undefined) transactionStart = sessionTimeout;
      } else if (stmt.type === 'TRANSACTION_COMMIT') {
        if (stmt.pgAst?.kind === 'TRANS_STMT_ROLLBACK' && transactionStart !== undefined) sessionTimeout = transactionStart;
        transactionStart = stmt.pgAst?.chain ? sessionTimeout : undefined;
        localTimeout = undefined;
      } else if (stmt.type === 'SET_VARIABLE' && stmt.variable === 'lock_timeout') {
        const match = String(stmt.value || '').trim().match(/^(\d+(?:\.\d+)?)\s*(us|ms|s|min|h|d)?$/i);
        const scale = { us: 0.001, ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 };
        const milliseconds = match ? Number(match[1]) * scale[(match[2] || 'ms').toLowerCase()] : 0;
        const enabled = milliseconds >= 1 && milliseconds <= 2147483647;
        if (stmt.isLocal) {
          if (transactionStart !== undefined) localTimeout = enabled;
        } else {
          sessionTimeout = enabled;
          localTimeout = undefined;
        }
      } else if (stmt.type === 'RESET_VARIABLE' && ['lock_timeout', 'all'].includes(stmt.variable)) {
        sessionTimeout = false;
        localTimeout = undefined;
      } else if (ddlTypes.has(stmt.type) && !(localTimeout ?? sessionTimeout)) {
        unsafeStatement = stmt;
        break;
      }
    }
    const hasLockTimeout = !unsafeStatement;

    if (!hasLockTimeout) {
      violations.push({
        ruleId: this.id,
        ruleCode: this.code,
        ruleName: this.name,
        severity: Severity.HIGH,
        lockLevel: statementLock(unsafeStatement),
        table: 'global',
        line: unsafeStatement.line,
        sourceStart: unsafeStatement.sourceStart,
        raw: unsafeStatement.raw,
        inTransaction: transactionStart !== undefined,
        message: 'This SQL file does not establish an effective positive `SET lock_timeout` before this DDL statement. Verify session or role settings separately. A missing, disabled, reset or expired timeout can allow conflicting lock waits; it does not change the statement lock mode.'
      });
    }

    return violations;
  },

  generateSafeFix(violation, context = {}) {
    if (violation.inTransaction) {
      return [
        `-- Migration runs inside a transaction block. Use SET LOCAL to scope lock_timeout to this transaction:`,
        `SET LOCAL lock_timeout = '3s';`,
        `SET LOCAL statement_timeout = '30s';`
      ].join('\n');
    }

    return [
      '-- Choose timeouts for the actual workload. Run these statements individually on the same connection.',
      '-- Place the settings immediately before the affected DDL, after any preceding COMMIT or ROLLBACK.',
      "SET lock_timeout = '3s';",
      "SET statement_timeout = '30s';",
      violation.raw.replace(/;\s*$/, '')+';',
      'RESET lock_timeout;',
      'RESET statement_timeout;',
      '-- A timeout can abort DDL; inspect partial effects and invalid indexes before retrying.'
    ].join('\n');
  }
};
