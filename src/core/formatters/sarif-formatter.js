/**
 * LockGuard SARIF Formatter (v2.1.0)
 * Generates official OASIS SARIF JSON for GitHub Code Scanning and PR annotation.
 */

class SarifFormatter {
  static format(results, options = {}) {
    const rulesMap = new Map();
    const sarifResults = [];

    for (const res of results) {
      if (!res.violations) continue;

      for (const v of res.violations) {
        if (!rulesMap.has(v.ruleId)) {
          rulesMap.set(v.ruleId, {
            id: v.ruleId,
            name: v.ruleCode || v.ruleId,
            shortDescription: { text: v.ruleName || v.ruleId },
            fullDescription: { text: v.message || v.ruleName },
            defaultConfiguration: {
              level: v.severity === 'CRITICAL' || v.severity === 'HIGH' ? 'error' : 'warning'
            },
            help: {
              text: v.safeFix ? `Safe SQL Recipe:\n${v.safeFix}` : 'Follow PostgreSQL zero-downtime migration guidelines.'
            }
          });
        }

        sarifResults.push({
          ruleId: v.ruleId,
          level: v.severity === 'CRITICAL' || v.severity === 'HIGH' ? 'error' : 'warning',
          message: {
            text: `[${v.lockLevel || 'ACCESS EXCLUSIVE'}] ${v.message}`
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: res.filename.replace(/\\/g, '/')
                },
                region: {
                  startLine: v.line || 1,
                  startColumn: 1
                }
              }
            }
          ]
        });
      }
    }

    const sarifDoc = {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'LockGuard',
              version: require('../../../package.json').version,
              informationUri: 'https://github.com/Mars444456/lockguard',
              rules: Array.from(rulesMap.values())
            }
          },
          results: sarifResults
        }
      ]
    };

    return JSON.stringify(sarifDoc, null, 2);
  }
}

module.exports = SarifFormatter;
