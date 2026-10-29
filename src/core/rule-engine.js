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
      rule08
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
   * @param {object} options { filename, enabledRuleIds, failOnSeverity }
   */
  analyze(sqlText, options = {}) {
    const filename = options.filename || 'migration.sql';
    const enabledRuleIds = options.enabledRuleIds || null;
    const failOnSeverity = options.failOnSeverity || Severity.HIGH;

    // 1. Parse AST
    const astStatements = PgParser.parse(sqlText);

    // 2. Run Rules
    const violations = [];
    const activeRules = enabledRuleIds 
      ? this.rules.filter(r => enabledRuleIds.includes(r.id))
      : this.rules;

    for (const rule of activeRules) {
      try {
        const found = rule.check(astStatements, { filename, sqlText });
        for (const v of found) {
          const safeFix = rule.generateSafeFix ? rule.generateSafeFix(v) : null;
          violations.push({
            ...v,
            safeFix,
            lockDetails: LockMatrix[v.lockLevel] || null
          });
        }
      } catch (err) {
        console.error(`Error running rule ${rule.id}:`, err);
      }
    }

    // 3. Determine Affected Tables
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

    // 4. Calculate Highest Lock Level
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

    // 5. Verdict & Status
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

    return {
      filename,
      status,
      passed,
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
