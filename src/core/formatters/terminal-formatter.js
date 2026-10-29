/**
 * CLI Terminal Output Formatter with ANSI colors
 */

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m'
};

class TerminalFormatter {
  static format(results) {
    const list = Array.isArray(results) ? results : [results];
    const lines = [];

    lines.push('');
    lines.push(`${colors.bold}${colors.cyan}========================================================================${colors.reset}`);
    lines.push(`${colors.bold}${colors.cyan}  🛡️  LockGuard: PostgreSQL DDL Lock & Migration Gatekeeper${colors.reset}`);
    lines.push(`${colors.bold}${colors.cyan}========================================================================${colors.reset}`);
    lines.push('');

    let totalViolations = 0;
    let totalCritical = 0;
    let anyFailed = false;

    for (const res of list) {
      totalViolations += res.violationsCount;
      totalCritical += res.criticalCount;
      if (!res.passed) anyFailed = true;

      const badge = res.passed
        ? `${colors.bgGreen}${colors.white}${colors.bold} PASSED ${colors.reset}`
        : `${colors.bgRed}${colors.white}${colors.bold} BLOCKED (DANGEROUS LOCKS) ${colors.reset}`;

      lines.push(`File: ${colors.bold}${res.filename}${colors.reset}  ${badge}`);
      lines.push(`Statements: ${res.astStatementsCount} | Violations: ${res.violationsCount} (Critical: ${res.criticalCount}, High: ${res.highCount})`);
      lines.push(`Max Lock Acquired: ${colors.bold}${colors.yellow}${res.highestLockLevel}${colors.reset}`);
      if (res.affectedTables.length > 0) {
        lines.push(`Affected Tables: ${res.affectedTables.map(t => colors.cyan + t + colors.reset).join(', ')}`);
      }
      lines.push('');

      if (res.violations.length === 0) {
        lines.push(`  ${colors.green}✔ No dangerous table locks detected. Safe for zero-downtime deployment.${colors.reset}`);
        lines.push('');
        continue;
      }

      lines.push(`${colors.bold}Detected Lock Anti-Patterns:${colors.reset}`);
      lines.push('------------------------------------------------------------------------');

      for (let idx = 0; idx < res.violations.length; idx++) {
        const v = res.violations[idx];
        const sevColor = v.severity === 'CRITICAL' ? colors.red : (v.severity === 'HIGH' ? colors.yellow : colors.blue);
        
        lines.push(` [${idx + 1}] ${sevColor}${colors.bold}[${v.severity}]${colors.reset} ${colors.bold}${v.ruleName}${colors.reset} (${v.ruleId})`);
        lines.push(`     Line: ${v.line} | Table: ${colors.cyan}${v.table}${colors.reset} | Lock: ${colors.magenta}${v.lockLevel}${colors.reset}`);
        lines.push(`     Risk: ${v.message}`);
        
        if (v.safeFix) {
          lines.push(`     ${colors.green}${colors.bold}Safe SQL Alternative:${colors.reset}`);
          const fixLines = v.safeFix.split('\n');
          for (const fl of fixLines) {
            lines.push(`       ${colors.dim}${fl}${colors.reset}`);
          }
        }
        lines.push('');
      }
    }

    lines.push('------------------------------------------------------------------------');
    if (anyFailed) {
      lines.push(`${colors.red}${colors.bold}✖ CI/CD RELEASE BLOCKED: Dangerous locks detected that could freeze production database!${colors.reset}`);
      lines.push(`${colors.yellow}Fix the anti-patterns above or use safe concurrent alternatives.${colors.reset}`);
    } else {
      lines.push(`${colors.green}${colors.bold}✔ ALL CHECKS PASSED: Migration conforms to PostgreSQL zero-downtime standards.${colors.reset}`);
    }
    lines.push('');

    return lines.join('\n');
  }
}

module.exports = TerminalFormatter;
