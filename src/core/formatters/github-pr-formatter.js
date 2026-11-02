/**
 * GitHub Pull Request Comment Markdown Formatter
 * Generates structured Markdown tables, danger badges, and collapsible safe fixes.
 */

class GitHubPrFormatter {
  static format(results) {
    const list = Array.isArray(results) ? results : [results];
    const md = [];
    if(!list.length)return '<!-- lockguard-report -->\n## LockGuard\nNo SQL migration files were checked. This is not an approval of database changes.\n';

    let totalViolations = 0;
    let totalCritical = 0;
    let totalHigh = 0;
    let anyFailed = false;

    for (const r of list) {
      totalViolations += r.violationsCount;
      totalCritical += r.criticalCount;
      totalHigh += r.highCount;
      if (!r.passed) anyFailed = true;
    }

    // Marker for Sticky PR Comment tracking
    md.push('<!-- lockguard-report -->');
    md.push('## 🛡️ LockGuard: PostgreSQL Migration Safety Gatekeeper');
    md.push('');
    for(const r of list)if(r.coverageComplete===false)md.push(`> ⚠️ **PARTIAL COVERAGE**: ${r.coverage?.disabledRuleIds?.length||0} disabled rule(s), ${r.coverage?.suppressedFindings?.length||0} suppressed finding(s). Do not treat this as a complete review.`);

    if (anyFailed) {
      md.push('> ❌ **MERGE BLOCKED**: Findings meet the configured failure threshold. Review the SQL, schema and transaction boundaries. Application impact and lock waiting have not been measured.');
    } else if (totalViolations > 0) {
      md.push('> ⚠️ **WARNING**: Findings are below the configured failure threshold. This does not mean the operations are non-blocking.');
    } else {
      md.push('> ✅ **NO RULE FINDINGS**: No configured checks reported a finding. DDL can still acquire locks. Runtime behavior and downtime are not measured or guaranteed.');
    }
    md.push('');

    // Summary Metrics Table
    md.push('### 📊 Summary');
    md.push('');
    md.push('| Metric | Status |');
    md.push('| :--- | :--- |');
    md.push(`| **Overall Verdict** | ${anyFailed ? '🛑 **FAILED (Release Blocked)**' : '🟢 **PASSED**'} |`);
    md.push(`| **Files Audited** | \`${list.length}\` |`);
    md.push(`| **Total Violations** | **${totalViolations}** (${totalCritical} Critical, ${totalHigh} High) |`);
    md.push('');

    // Table of Files & Highest Lock
    md.push('### 📁 Migration Files & Max Lock Level');
    md.push('');
    md.push('| File | Status | Max Lock Inferred | Affected Tables | Violations |');
    md.push('| :--- | :---: | :---: | :--- | :---: |');

    for (const r of list) {
      const fileBadge = r.passed ? '🟢 PASS' : '🔴 FAIL';
      const lockBadge = r.highestLockLevel === 'ACCESS EXCLUSIVE' 
        ? `\`${r.highestLockLevel}\` ⛔` 
        : (r.highestLockLevel === 'SHARE' ? `\`${r.highestLockLevel}\` ⚠️` : `\`${r.highestLockLevel}\``);
      const tables = r.affectedTables.length > 0 ? r.affectedTables.map(t => `\`${t}\``).join(', ') : '_None_';

      md.push(`| \`${r.filename}\` | ${fileBadge} | ${lockBadge} | ${tables} | **${r.violationsCount}** |`);
    }
    md.push('');

    // Detailed Violations & Safe Fixes
    if (totalViolations > 0) {
      md.push('### ⚠️ Detailed Lock Anti-Patterns & Suggestions for Manual Review');
      md.push('');

      for (const r of list) {
        if (r.violations.length === 0) continue;

        md.push(`#### 📄 \`${r.filename}\``);
        md.push('');
        md.push('| # | Severity | Rule | Table | Lock Level | Line | Description |');
        md.push('| :-: | :---: | :--- | :--- | :---: | :-: | :--- |');

        for (let idx = 0; idx < r.violations.length; idx++) {
          const v = r.violations[idx];
          const sevIcon = v.severity === 'CRITICAL' ? '🔴 **CRITICAL**' : (v.severity === 'HIGH' ? '🟠 **HIGH**' : '🟡 **MEDIUM**');
          md.push(`| ${idx + 1} | ${sevIcon} | **${v.ruleName}** (\`${v.ruleId}\`) | \`${v.table}\` | \`${v.lockLevel}\` | L${v.line} | ${v.message} |`);
        }
        md.push('');

        // Collapsible Safe Fixes
        for (let idx = 0; idx < r.violations.length; idx++) {
          const v = r.violations[idx];
          if (v.safeFix) {
            md.push(`<details>`);
            md.push(`<summary>💡 <b>Review suggestion for #${idx + 1} (${v.ruleName} on <code>${v.table}</code>)</b></summary>`);
            md.push('');
            md.push('```sql');
            md.push(v.safeFix);
            md.push('```');

            md.push('</details>');
            md.push('');
          }
        }
      }
    }

    // Explanatory Footer
    md.push('---');
    md.push('> 💡 **Why does LockGuard block this?**');
    md.push('> ACCESS EXCLUSIVE conflicts with ordinary SELECT on the same relation. A waiting DDL request can queue later conflicting requests. The affected operations and waiting time depend on the actual lock mode, transaction lifetime, workload and timeouts; this report does not establish an outage.');
    md.push('');
    md.push('*Report generated automatically by [LockGuard](https://github.com/Mars444456/lockguard)*');

    return md.join('\n');
  }
}

module.exports = GitHubPrFormatter;
