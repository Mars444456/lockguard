const PgParser = require('./pg-parser');
const { LockLevel, Severity, LockMatrix } = require('./types');

const rule01 = require('./rules/rule01-add-column-default');
const rule02 = require('./rules/rule02-create-index-concurrently');
const rule03 = require('./rules/rule03-foreign-key-not-valid');
const rule04 = require('./rules/rule04-alter-column-type');
const rule05 = require('./rules/rule05-unique-constraint');
const rule06 = require('./rules/rule06-drop-column-table');
const rule07 = require('./rules/rule07-vacuum-in-transaction');
const rule08 = require('./rules/rule08-missing-lock-timeout');
const rule09 = require('./rules/rule09-unsafe-set-not-null');
const rule10 = require('./rules/rule10-concurrently-in-transaction');

class RuleEngine {
  constructor(customRules = null) {
    this.rules = customRules || [
      rule01,
      rule02,
      rule03,
      rule04,
      rule05,
      rule06,
      rule07,
      rule08,
      rule09,
      rule10
    ];
  }

  /**
   * Returns list of all registered rules metadata.
   */
  getRules() {
    return this.rules.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      severity: r.severity,
      lockLevel: r.lockLevel,
      description: r.description
    }));
  }

  /**
   * Analyzes SQL script and checks for dangerous table locks.
   * @param {string} sqlText 
   * @param {object} options { filename, enabledRuleIds, failOnSeverity, ignoreRules }
   */
  analyze(sqlText, options = {}) {
    const filename = options.filename || 'migration.sql';
    const enabledRuleIds = options.enabledRuleIds || null;
    const failOnSeverity = options.failOnSeverity || Severity.HIGH;
    const configIgnoreRules = (options.ignoreRules || []).map(r => r.toUpperCase());

    // 1. Parse AST
    const astStatements = PgParser.parse(sqlText);

    // 2. Build Context (Created tables in this migration, transaction state)
    const createdTables = new Set();
    let hasTransactionBlock = false;

    for (const stmt of astStatements) {
      if (stmt.type === 'CREATE_TABLE' && stmt.table) {
        createdTables.add(stmt.table.toLowerCase());
      }
      if (stmt.type === 'TRANSACTION_START') {
        hasTransactionBlock = true;
      }
    }

    const context = {
      filename,
      sqlText,
      createdTables,
      hasTransactionBlock,
      ...options
    };

    // 3. Run Rules
    const rawViolations = [];
    const activeRules = enabledRuleIds 
      ? this.rules.filter(r => enabledRuleIds.includes(r.id))
      : this.rules;

    for (const rule of activeRules) {
      // Check if rule is disabled globally in config
      if (configIgnoreRules.includes(rule.id.toUpperCase())) {
        continue;
      }

      try {
        const found = rule.check(astStatements, context);
        for (const v of found) {
          // Check inline statement-level ignore directives (-- lockguard-ignore: LG-XXX)
          const targetStmt = astStatements.find(s => 
            s.line === v.line || 
            (s.subcommands && s.subcommands.some(sub => sub.line === v.line))
          );

          if (targetStmt) {
            if (targetStmt.ignoreAll) {
              continue;
            }
            if (targetStmt.ignoreRules && targetStmt.ignoreRules.includes(v.ruleId.toUpperCase())) {
              continue;
            }
          }

          const safeFix = rule.generateSafeFix ? rule.generateSafeFix(v, context) : null;
          rawViolations.push({
            ...v,
            safeFix,
            lockDetails: LockMatrix[v.lockLevel] || null
          });
        }
      } catch (err) {
        console.error(`Error running rule ${rule.id}:`, err);
      }
    }

    const violations = rawViolations;

    // 4. Determine Affected Tables
    const affectedTablesSet = new Set();
    for (const stmt of astStatements) {
      if (stmt.table && stmt.table !== 'global' && stmt.table !== 'unknown_table') {
        affectedTablesSet.add(stmt.table);
      }
      if (stmt.tables) {
        stmt.tables.forEach(t => affectedTablesSet.add(t));
      }
    }
    for (const v of violations) {
      if (v.table && v.table !== 'global' && v.table !== 'unknown_table') {
        affectedTablesSet.add(v.table);
      }
    }
    const affectedTables = Array.from(affectedTablesSet);

    // 5. Calculate Highest Lock Level
    const lockPriority = [
      LockLevel.ACCESS_SHARE,
      LockLevel.ROW_SHARE,
      LockLevel.ROW_EXCLUSIVE,
      LockLevel.SHARE_UPDATE_EXCLUSIVE,
      LockLevel.SHARE,
      LockLevel.SHARE_ROW_EXCLUSIVE,
      LockLevel.EXCLUSIVE,
      LockLevel.ACCESS_EXCLUSIVE
    ];

    let highestLock = LockLevel.ACCESS_SHARE;
    for (const v of violations) {
      if (v.lockLevel && lockPriority.indexOf(v.lockLevel) > lockPriority.indexOf(highestLock)) {
        highestLock = v.lockLevel;
      }
    }

    // 6. Verdict & Status
    const criticalCount = violations.filter(v => v.severity === Severity.CRITICAL).length;
    const highCount = violations.filter(v => v.severity === Severity.HIGH).length;
    const mediumCount = violations.filter(v => v.severity === Severity.MEDIUM).length;

    let passed = true;
    if (failOnSeverity === Severity.CRITICAL && criticalCount > 0) {
      passed = false;
    } else if (failOnSeverity === Severity.HIGH && (criticalCount > 0 || highCount > 0)) {
      passed = false;
    } else if (failOnSeverity === Severity.MEDIUM && (criticalCount > 0 || highCount > 0 || mediumCount > 0)) {
      passed = false;
    }

    const status = violations.length === 0 ? 'PASSED' : (passed ? 'WARNING' : 'FAILED');

    const hasDdl = astStatements.some(s => 
      s.type === 'ALTER_TABLE' || 
      s.type === 'CREATE_INDEX' || 
      s.type === 'DROP_TABLE' ||
      s.type === 'CREATE_TABLE' ||
      s.type === 'DROP_INDEX' ||
      s.type === 'VACUUM'
    );
    const isDmlOnly = !hasDdl && astStatements.length > 0;

    return {
      filename,
      status,
      passed,
      isDmlOnly,
      dmlDescription: isDmlOnly ? 'Операция не является DDL-миграцией схемы (SELECT / DML чтение/запись данных). Блокировок DDL нет, простой базы: 0.0 сек.' : null,
      violationsCount: violations.length,
      criticalCount,
      highCount,
      mediumCount,
      highestLockLevel: violations.length > 0 ? highestLock : LockLevel.ACCESS_SHARE,
      lockImpact: LockMatrix[highestLock] || null,
      affectedTables,
      violations,
      astStatementsCount: astStatements.length,
      analyzedAt: new Date().toISOString()
    };
  }
}

module.exports = RuleEngine;
