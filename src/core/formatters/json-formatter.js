/**
 * JSON Formatter for CI/CD programmatic consumers
 */

class JsonFormatter {
  static format(results) {
    const list = Array.isArray(results) ? results : [results];
    return JSON.stringify({
      version: '1.0.0',
      gatekeeper: 'LockGuard',
      summary: {
        totalFiles: list.length,
        passed: list.every(r => r.passed),
        totalViolations: list.reduce((acc, r) => acc + r.violationsCount, 0),
        criticalCount: list.reduce((acc, r) => acc + r.criticalCount, 0),
        highCount: list.reduce((acc, r) => acc + r.highCount, 0),
        mediumCount: list.reduce((acc, r) => acc + r.mediumCount, 0)
      },
      results: list
    }, null, 2);
  }
}

module.exports = JsonFormatter;
