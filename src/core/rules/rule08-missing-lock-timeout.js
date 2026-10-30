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

    // Look for SET lock_timeout in the statements
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
