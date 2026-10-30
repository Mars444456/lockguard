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
    let transactionStart;
    let unsafeStatement;
    const ddlTypes = new Set(['ALTER_TABLE', 'CREATE_INDEX', 'DROP_TABLE', 'CREATE_TABLE', 'DROP_INDEX', 'TRUNCATE_TABLE', 'REFRESH_MATVIEW']);
    for (const stmt of astStatements) {
      if (stmt.type === 'TRANSACTION_START') {
        transactionStart = sessionTimeout;
      } else if (stmt.type === 'TRANSACTION_COMMIT') {
        if (/^ROLLBACK\b/i.test(stmt.raw) && transactionStart !== undefined) sessionTimeout = transactionStart;
        transactionStart = undefined;
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
        lockLevel: LockLevel.ACCESS_EXCLUSIVE,
        table: 'global',
        line: unsafeStatement.line,
        raw: unsafeStatement.raw,
        message: 'No effective positive `SET lock_timeout` before this DDL statement. A missing, disabled, reset or expired timeout can allow lock waits to block production traffic.'
      });
    }

    return violations;
  },

  generateSafeFix(violation, context = {}) {
    if (context.hasTransactionBlock) {
      return [
        `-- Migration runs inside a transaction block. Use SET LOCAL to scope lock_timeout to this transaction:`,
        `SET LOCAL lock_timeout = '3s';`,
        `SET LOCAL statement_timeout = '30s';`
      ].join('\n');
    }

    return [
      `-- Basic Pattern: Add lock_timeout at top and RESET at end:`,
      `SET lock_timeout = '3s';`,
      `SET statement_timeout = '30s';`,
      ``,
      `-- ... (your migration statements here) ...`,
      ``,
      `RESET lock_timeout;`,
      `RESET statement_timeout;`,
      ``,
      `-- Advanced Pattern: Zero-Downtime PL/pgSQL Lock-Retry loop:`,
      `DO $$`,
      `DECLARE`,
      `  success BOOLEAN := FALSE;`,
      `  attempts INT := 0;`,
      `BEGIN`,
      `  WHILE NOT success AND attempts < 5 LOOP`,
      `    BEGIN`,
      `      SET LOCAL lock_timeout = '2s';`,
      `      -- (Run your DDL command here)`,
      `      success := TRUE;`,
      `      EXIT;`,
      `    EXCEPTION WHEN lock_not_available THEN`,
      `      attempts := attempts + 1;`,
      `      PERFORM pg_sleep(1);`,
      `    END;`,
      `  END LOOP;`,
      `  IF NOT success THEN`,
      `    RAISE EXCEPTION 'Could not acquire lock after 5 attempts';`,
      `  END IF;`,
      `END $$;`
    ].join('\n');
  }
};
