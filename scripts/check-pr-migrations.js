const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function run(base = process.env.LOCKGUARD_BASE_SHA, report = 'lockguard-pr-report.md') {
  if (!/^[a-f0-9]{40}$/i.test(base || '')) throw new Error('LOCKGUARD_BASE_SHA must be the full pull-request base SHA.');
  const files = execFileSync('git', ['diff', '--name-only', '-z', '--diff-filter=ACMR', `${base}...HEAD`, '--'], {
    encoding: 'utf8', timeout: 15000
  }).split('\0').filter(file => file.endsWith('.sql') && !/^(?:fixtures|test)\//.test(file));
  if (!files.length) {
    fs.writeFileSync(report, '# LockGuard\n\nNo changed SQL migrations; fixtures and test SQL are checked by the test suite.\n');
    return 0;
  }
  const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/lockguard.js'), 'check', ...files,
    '--format=github-pr-comment', `--output=${report}`], { stdio: 'inherit', timeout: 120000 });
  if (result.error) throw result.error;
  return result.status === 0 || result.status === 1 ? result.status : 2;
}

if (require.main === module) {
  try { process.exitCode = run(); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
module.exports = { run };
