const fs = require('fs');
const path = require('path');
const GitStaged = require('./git-staged');
const RuleEngine = require('../core/rule-engine');
const TerminalFormatter = require('../core/formatters/terminal-formatter');

class GitHookManager {
  /**
   * Installs pre-commit hook into the current repository.
   */
  static installHook(targetDir = process.cwd()) {
    const gitDir = path.join(targetDir, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new Error(`Directory '${targetDir}' is not a Git repository (.git not found).`);
    }

    const hooksDir = path.join(gitDir, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    const preCommitPath = path.join(hooksDir, 'pre-commit');
    if (fs.existsSync(preCommitPath)) {
      throw new Error('A pre-commit hook already exists. Add LockGuard to it manually to preserve existing checks.');
    }

    const hookScript = `#!/bin/sh
# LockGuard Shift-Left Pre-commit Gatekeeper
# Automatically audits staged PostgreSQL migrations before git commit.

echo "🛡️  LockGuard: Auditing staged PostgreSQL migrations..."

# Run LockGuard CLI gatekeeper on staged files
npx --no-install lockguard check --staged

STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo ""
  echo "❌ LockGuard blocked commit: Staged migrations contain dangerous table locks!"
  echo "💡 Run 'npx lockguard rules' or inspect fixes above."
  exit 1
fi

exit 0
`;

    fs.writeFileSync(preCommitPath, hookScript, { mode: 0o755 });
    return {
      success: true,
      hookPath: preCommitPath,
      message: '✔ Successfully installed LockGuard pre-commit hook into .git/hooks/pre-commit'
    };
  }

  /**
   * Alias for runHook, invoked by CLI handleHookCommand.
   */
  static runPreCommitAudit() {
    return this.runHook();
  }

  /**
   * Executed by the pre-commit hook to audit only git-staged .sql files.
   */
  static runHook() {
    try {
      // Get staged .sql files
      const stagedSqlFiles = GitStaged.list();

      if (stagedSqlFiles.length === 0) {
        return 0; // No SQL migrations staged
      }

      console.log(`Auditing ${stagedSqlFiles.length} staged migration file(s)...`);

      const engine = new RuleEngine();
      const results = [];

      for (const file of stagedSqlFiles) {
        const sql = GitStaged.read(file);
        const res = engine.analyze(sql, { filename: file, failOnSeverity: 'HIGH' });
        results.push(res);
      }

      const anyFailed = results.some(r => !r.passed);
      console.log(TerminalFormatter.format(results));

      return anyFailed ? 1 : 0;
    } catch (err) {
      console.error('LockGuard pre-commit audit failed:', err.message);
      return 2;
    }
  }
}

module.exports = GitHookManager;
