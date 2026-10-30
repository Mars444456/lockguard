/**
 * JSON Formatter for CI/CD programmatic consumers
 */

class JsonFormatter {
  static format(results) {
    const list = Array.isArray(results) ? results : [results];
    const allViolations = list.flatMap(r => (r.violations || []).map(v => ({
      ...v,
      file: v.file || r.filename
    })));

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
      violations: allViolations,
      results: list.map(r => ({
        ...r,
        file: r.file || r.filename,
        violations: (r.violations || []).map(v => ({
          ...v,
          file: v.file || r.filename
        }))
      }))
    }, null, 2);
  }
}

module.exports = JsonFormatter;
