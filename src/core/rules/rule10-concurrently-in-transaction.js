const { LockLevel, Severity } = require('../types');

module.exports = {
  id: 'LG-010',
  code: 'CONCURRENTLY_IN_TRANSACTION',
  name: 'CONCURRENTLY operation executed inside transaction block',
  severity: Severity.CRITICAL,
  lockLevel: LockLevel.ACCESS_EXCLUSIVE,
  description: 'PostgreSQL does not allow CREATE INDEX CONCURRENTLY, DROP INDEX CONCURRENTLY, or REINDEX CONCURRENTLY inside a transaction block (BEGIN...COMMIT). The migration will crash with ERROR 25001.',

  check(astStatements, context = {}) {
    const violations = [];
    const hasTransaction = context.hasTransactionBlock || astStatements.some(s => s.type === 'TRANSACTION_START');

    if (!hasTransaction) {
      return violations;
    }

    for (const stmt of astStatements) {
      const isConcurrent = (stmt.type === 'CREATE_INDEX' && stmt.isConcurrent) ||
                           (stmt.type === 'DROP_INDEX' && stmt.isConcurrent) ||
                           (stmt.type === 'REINDEX' && stmt.isConcurrent);

      if (isConcurrent) {
        violations.push({
          ruleId: this.id,
          ruleCode: this.code,
          ruleName: this.name,
          severity: Severity.CRITICAL,
          lockLevel: this.lockLevel,
          table: stmt.table || 'global',
          line: stmt.line,
          raw: stmt.raw,
          message: `PostgreSQL prohibits CONCURRENTLY operations inside a transaction block (BEGIN...COMMIT)! Running this will immediately fail with: ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.`
        });
      }
    }

    return violations;
  },

  generateSafeFix(violation) {
    const rawSql = violation.raw || 'CREATE INDEX CONCURRENTLY idx ON table(col);';
    return [
      `-- Safe recipe: Remove the transaction block (BEGIN...COMMIT) around CONCURRENTLY operations:`,
      `-- In modern migration frameworks (Flyway, Liquibase, Knex, Prisma), disable transactions for this file:`,
      `-- (e.g. set: transaction = false or @transactional false)`,
      ``,
      `${rawSql}`
    ].join('\n');
  }
};
