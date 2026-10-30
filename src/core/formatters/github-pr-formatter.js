/**
 * GitHub Pull Request Comment Markdown Formatter
 * Generates structured Markdown tables, danger badges, and collapsible safe fixes.
 */

class GitHubPrFormatter {
  static format(results) {
    const list = Array.isArray(results) ? results : [results];
    const md = [];

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

    if (anyFailed) {
      md.push('> ❌ **MERGE BLOCKED**: One or more migrations acquire dangerous PostgreSQL table locks (`ACCESS EXCLUSIVE` / `SHARE`) that can freeze your production database or cause 504 Gateway Timeouts.');
    } else if (totalViolations > 0) {
      md.push('> ⚠️ **WARNING**: Non-blocking migration warnings detected. Review best practices before deployment.');
    } else {
      md.push('> ✅ **ALL MIGRATIONS SAFE**: No dangerous locks detected. Conforms to PostgreSQL zero-downtime deployment standards.');
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
    md.push('| File | Status | Max Lock Acquired | Affected Tables | Violations |');
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
      md.push('### ⚠️ Detailed Lock Anti-Patterns & Safe SQL Alternatives');
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
            md.push(`<summary>💡 <b>Safe SQL Fix for #${idx + 1} (${v.ruleName} on <code>${v.table}</code>)</b></summary>`);
            md.push('');
            md.push('```sql');
            md.push(v.safeFix);
            md.push('```');
            if (v.ruleId === 'LG-002' || v.ruleId === 'LG-008') {
              md.push('');
              md.push(`> 💡 **Auto-Fix Available:** You can apply this fix automatically with: \`npx lockguard check ${r.filename} --fix\``);
            }
            md.push('</details>');
            md.push('');
          }
        }
      }
    }

    // Explanatory Footer
    md.push('---');
    md.push('> 💡 **Why does LockGuard block this?**');
    md.push('> In PostgreSQL, `ACCESS EXCLUSIVE` locks block even simple `SELECT` queries. If an incoming DDL transaction cannot acquire this lock immediately because of an in-flight query, it blocks in queue and subsequently freezes **all** following read and write requests, creating a catastrophic cascading outage.');
    md.push('');
    md.push('*Report generated automatically by [LockGuard CI/CD Gatekeeper](https://lockguard.dev)*');

    return md.join('\n');
  }
}

module.exports = GitHubPrFormatter;
