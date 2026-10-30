const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('child_process');

const CLI_PATH = path.resolve(__dirname, '../bin/lockguard.js');

function runCli(args = [], options = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    ...options
  });
}

function createTempDir(prefix = 'lockguard-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ==============================================================================
// 1. Exit Codes (status)
// ==============================================================================
test('CLI E2E - fixtures/10_safe_migration.sql exits with status 0', () => {
  const safeFile = path.resolve(__dirname, '../fixtures/10_safe_migration.sql');
  const res = runCli(['check', safeFile]);
  assert.equal(res.status, 0, `Expected status 0 for safe migration, stderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('PASSED'));
});

test('CLI E2E - fixtures/09_catastrophic_combined.sql exits with status 1 and finds all anti-patterns', () => {
  const badFile = path.resolve(__dirname, '../fixtures/09_catastrophic_combined.sql');
  const res = runCli(['check', badFile, '--format=json']);
  assert.equal(res.status, 1, 'Expected status 1 for catastrophic migration');

  const json = JSON.parse(res.stdout);
  assert.equal(json.summary.passed, false);
  assert.ok(json.violations.length >= 6, 'Should detect multiple dangerous anti-patterns');

  const detectedRuleIds = json.violations.map(v => v.ruleId);
  assert.ok(detectedRuleIds.includes('LG-002'), 'Must detect LG-002 (CREATE INDEX non-concurrently)');
  assert.ok(detectedRuleIds.includes('LG-003'), 'Must detect LG-003 (Foreign key without NOT VALID)');
  assert.ok(detectedRuleIds.includes('LG-004'), 'Must detect LG-004 (ALTER COLUMN TYPE)');
  assert.ok(detectedRuleIds.includes('LG-005'), 'Must detect LG-005 (UNIQUE constraint direct)');
  assert.ok(detectedRuleIds.includes('LG-006'), 'Must detect LG-006 (DROP COLUMN)');
  assert.ok(detectedRuleIds.includes('LG-008'), 'Must detect LG-008 (Missing lock_timeout)');
});

test('CLI E2E - File with only WARN returns exit code 0 by default and exit code 1 with --strict', () => {
  const tmpDir = createTempDir();
  const warnSqlFile = path.join(tmpDir, '003_warn_only.sql');
  // autovacuum setting triggers LG-007 with MEDIUM severity (WARN)
  fs.writeFileSync(warnSqlFile, `
    SET lock_timeout = '3s';
    ALTER TABLE accounts SET (autovacuum_vacuum_scale_factor = 0.05);
  `, 'utf8');

  // Default run: should pass (exit code 0)
  const defaultRes = runCli(['check', warnSqlFile]);
  assert.equal(defaultRes.status, 0, 'Warn-only migration must return exit code 0 by default');

  // Strict run: should fail (exit code 1)
  const strictRes = runCli(['check', warnSqlFile, '--strict']);
  assert.equal(strictRes.status, 1, 'Warn-only migration must return exit code 1 with --strict');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI E2E - Non-existent path or empty directory outputs message without crashing', () => {
  // Non-existent path
  const resNonExistent = runCli(['check', 'non_existent_migration_dir_xyz_123']);
  assert.equal(resNonExistent.status, 0);
  assert.ok(!resNonExistent.stderr.includes('ReferenceError'), 'Must not throw ReferenceError');
  assert.ok(!resNonExistent.stderr.includes('TypeError'), 'Must not throw TypeError');

  // Empty directory
  const emptyDir = createTempDir('lockguard-empty-');
  const resEmpty = runCli(['check', emptyDir]);
  assert.equal(resEmpty.status, 0);
  assert.ok(!resEmpty.stderr.includes('ReferenceError'), 'Must not throw ReferenceError');
  assert.ok(!resEmpty.stderr.includes('TypeError'), 'Must not throw TypeError');

  fs.rmSync(emptyDir, { recursive: true, force: true });
});

// ==============================================================================
// 2. Output Formats (--format json, --format sarif, --format github-pr-comment)
// ==============================================================================
test('CLI E2E - --format json parses without error and contains summary, violations, file, line, ruleId', () => {
  const tmpDir = createTempDir();
  const sqlFile = path.join(tmpDir, 'test_json.sql');
  fs.writeFileSync(sqlFile, `
    SET lock_timeout = '3s';
    CREATE INDEX idx_orders_user ON orders (user_id);
  `, 'utf8');

  const res = runCli(['check', sqlFile, '--format=json']);
  assert.equal(res.status, 1);

  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout);
  }, 'Output must be valid JSON');

  assert.ok(parsed.summary, 'JSON must contain "summary"');
  assert.equal(typeof parsed.summary.passed, 'boolean');
  assert.equal(typeof parsed.summary.totalViolations, 'number');

  assert.ok(Array.isArray(parsed.violations), 'JSON must contain "violations" array');
  assert.ok(parsed.violations.length > 0, 'Violations array must not be empty');

  const v = parsed.violations[0];
  assert.ok(v.file, 'Violation must contain "file"');
  assert.ok(v.line, 'Violation must contain "line"');
  assert.equal(v.ruleId, 'LG-002', 'Violation must contain "ruleId"');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI E2E - --format sarif outputs valid OASIS SARIF 2.1.0 schema with runs[0].results', () => {
  const tmpDir = createTempDir();
  const sqlFile = path.join(tmpDir, 'test_sarif.sql');
  fs.writeFileSync(sqlFile, `
    SET lock_timeout = '3s';
    ALTER TABLE users ADD CONSTRAINT fk_acc FOREIGN KEY (account_id) REFERENCES accounts(id);
  `, 'utf8');

  const res = runCli(['check', sqlFile, '--format=sarif']);
  assert.equal(res.status, 1);

  let sarif;
  assert.doesNotThrow(() => {
    sarif = JSON.parse(res.stdout);
  }, 'Output must be valid SARIF JSON');

  assert.equal(sarif.version, '2.1.0', 'SARIF version must be 2.1.0');
  assert.ok(Array.isArray(sarif.runs), 'SARIF must contain runs array');
  assert.equal(sarif.runs[0].tool.driver.name, 'LockGuard');
  assert.ok(Array.isArray(sarif.runs[0].results), 'runs[0] must contain results array');
  assert.ok(sarif.runs[0].results.length > 0, 'results must contain detected violations');
  assert.equal(sarif.runs[0].results[0].ruleId, 'LG-003');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI E2E - --format github-pr-comment contains Markdown table and <details> collapsible blocks', () => {
  const tmpDir = createTempDir();
  const sqlFile = path.join(tmpDir, 'test_pr.sql');
  fs.writeFileSync(sqlFile, `
    SET lock_timeout = '3s';
    CREATE INDEX idx_users_email ON users (email);
  `, 'utf8');

  const res = runCli(['check', sqlFile, '--format=github-pr-comment']);
  assert.equal(res.status, 1);

  assert.ok(res.stdout.includes('|'), 'Output should contain Markdown table pipes');
  assert.ok(res.stdout.includes('<details>'), 'Output should contain <details> block');
  assert.ok(res.stdout.includes('</details>'), 'Output should contain closing </details> block');
  assert.ok(res.stdout.includes('<!-- lockguard-report -->'), 'Output should contain sticky report marker');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ==============================================================================
// 3. Auto-Fix (--fix)
// ==============================================================================
test('CLI E2E - Auto-fix (--fix) heals unsafe file in os.tmpdir(), adding lock_timeout and CONCURRENTLY', () => {
  const tmpDir = createTempDir();
  const tmpSql = path.join(tmpDir, 'unsafe_migration.sql');

  // Copy/write an unsafe SQL migration without lock_timeout and non-concurrent index
  const unsafeSql = `CREATE INDEX idx_comments_post ON comments(post_id);`;
  fs.writeFileSync(tmpSql, unsafeSql, 'utf8');

  // Run with --fix
  const fixRes = runCli(['check', tmpSql, '--fix']);

  const fixedContent = fs.readFileSync(tmpSql, 'utf8');
  assert.ok(fixedContent.includes("SET lock_timeout = '3s';"), 'Auto-fix must prepend SET lock_timeout');
  assert.ok(fixedContent.includes("CREATE INDEX CONCURRENTLY idx_comments_post"), 'Auto-fix must inject CONCURRENTLY');
  assert.ok(fixedContent.includes("RESET lock_timeout;"), 'Auto-fix must append RESET lock_timeout for non-transactional DDL');
  assert.ok(fixedContent.includes("RESET statement_timeout;"), 'Auto-fix must append RESET statement_timeout');

  // Re-check must pass with code 0
  const checkRes = runCli(['check', tmpSql]);
  assert.equal(checkRes.status, 0, 'Re-checking fixed migration must exit with code 0');
  assert.ok(checkRes.stdout.includes('PASSED'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI E2E - Auto-fix preserves commented-out CREATE INDEX statements without modification', () => {
  const tmpDir = createTempDir();
  const tmpSql = path.join(tmpDir, 'comments_migration.sql');

  const contentWithComments = [
    `-- Example of old dangerous query:`,
    `-- CREATE INDEX idx_old_example ON users(email);`,
    `/*`,
    `   CREATE INDEX idx_block_comment ON orders(created_at);`,
    `*/`,
    `CREATE INDEX idx_real ON items(sku);`
  ].join('\n');

  fs.writeFileSync(tmpSql, contentWithComments, 'utf8');

  runCli(['check', tmpSql, '--fix']);

  const fixed = fs.readFileSync(tmpSql, 'utf8');
  assert.ok(fixed.includes('-- CREATE INDEX idx_old_example ON users(email);'), 'Must NOT modify single-line comments');
  assert.ok(fixed.includes('CREATE INDEX idx_block_comment ON orders(created_at);'), 'Must NOT modify block comments');
  assert.ok(fixed.includes('CREATE INDEX CONCURRENTLY idx_real ON items(sku);'), 'Must modify active DDL statement');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ==============================================================================
// 4. Config file (.lockguardrc.json)
// ==============================================================================
test('CLI E2E - .lockguardrc.json ignoreRules: ["LG-008"] disables LG-008', () => {
  const tmpDir = createTempDir();

  // Create .lockguardrc.json ignoring LG-008
  const configContent = JSON.stringify({
    ignoreRules: ['LG-008'],
    defaultLockTimeout: '3s',
    strict: false
  }, null, 2);
  fs.writeFileSync(path.join(tmpDir, '.lockguardrc.json'), configContent, 'utf8');

  // SQL file missing lock_timeout, but adding a safe column
  const sqlFile = path.join(tmpDir, '001_no_timeout.sql');
  fs.writeFileSync(sqlFile, `ALTER TABLE accounts ADD COLUMN nickname text;`, 'utf8');

  // Run with .lockguardrc.json in cwd: LG-008 is ignored, so it should exit 0
  const resIgnored = runCli(['check', '001_no_timeout.sql'], { cwd: tmpDir });
  assert.equal(resIgnored.status, 0, 'With ignoreRules: ["LG-008"], check should pass with exit code 0');
  assert.ok(resIgnored.stdout.includes('PASSED'));

  // Remove .lockguardrc.json: LG-008 will trigger and cause failure (exit code 1)
  fs.unlinkSync(path.join(tmpDir, '.lockguardrc.json'));
  const resEnforced = runCli(['check', '001_no_timeout.sql'], { cwd: tmpDir });
  assert.equal(resEnforced.status, 1, 'Without ignoreRules, LG-008 must fail with exit code 1');
  assert.ok(resEnforced.stdout.includes('LG-008'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ==============================================================================
// 5. CLI Auxiliary Commands (rules, split, simulate, watchdog, init, --version, --help)
// ==============================================================================
test('CLI E2E - lockguard rules lists rule catalog and exits 0', () => {
  const res = runCli(['rules']);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('LockGuard Active Rule Catalog'));
  assert.ok(res.stdout.includes('LG-001'));
  assert.ok(res.stdout.includes('LG-010'));
});

test('CLI E2E - lockguard split generates multi-phase migration and exits 0', () => {
  const badFile = path.resolve(__dirname, '../fixtures/09_catastrophic_combined.sql');
  const res = runCli(['split', badFile, '--orm=prisma']);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('LockGuard Auto-Splitter'));
  assert.ok(res.stdout.includes('PHASE'));
});

test('CLI E2E - lockguard watchdog inspects production index health and exits 0 when healthy', () => {
  const res = runCli(['watchdog']);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('LockGuard Post-Deploy Watchdog starting'));
  assert.ok(res.stdout.includes('healthy'));
});

test('CLI E2E - lockguard simulate measures lock contention and returns proper exit code', () => {
  const safeFile = path.resolve(__dirname, '../fixtures/10_safe_migration.sql');
  const safeRes = runCli(['simulate', safeFile]);
  assert.equal(safeRes.status, 0, 'Safe migration simulation should exit with 0');
  assert.ok(safeRes.stdout.includes('LockGuard Shadow Replay Simulation'));
  assert.ok(safeRes.stdout.includes('Outage Risk: NONE'));

  const badFile = path.resolve(__dirname, '../fixtures/09_catastrophic_combined.sql');
  const badRes = runCli(['simulate', badFile]);
  assert.equal(badRes.status, 1, 'Catastrophic migration simulation should exit with 1');
  assert.ok(badRes.stdout.includes('Outage Risk: CATASTROPHIC'));
});

test('CLI E2E - lockguard init creates .lockguardrc.json in target directory', () => {
  const tmpDir = createTempDir('lockguard-init-');
  const res = runCli(['init'], { cwd: tmpDir });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('.lockguardrc.json'));

  const generatedConfig = path.join(tmpDir, '.lockguardrc.json');
  assert.ok(fs.existsSync(generatedConfig));
  const parsed = JSON.parse(fs.readFileSync(generatedConfig, 'utf8'));
  assert.ok(parsed.defaultLockTimeout);
  assert.ok(Array.isArray(parsed.ignoreRules));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI E2E - lockguard --version and --help print info and exit 0', () => {
  const verRes = runCli(['--version']);
  assert.equal(verRes.status, 0);
  assert.ok(verRes.stdout.includes('LockGuard v'));

  const helpRes = runCli(['--help']);
  assert.equal(helpRes.status, 0);
  assert.ok(helpRes.stdout.includes('USAGE'));
  assert.ok(helpRes.stdout.includes('COMMANDS'));
});

test('CLI E2E - lockguard split --write creates phase files on disk that pass RuleEngine with 0 violations', () => {
  const tmpDir = createTempDir('lockguard-split-write-');
  const catSql = path.resolve(__dirname, '../fixtures/09_catastrophic_combined.sql');

  const res = runCli(['split', catSql, '--write', `--out-dir=${tmpDir}`]);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('Written'));

  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.sql'));
  assert.ok(files.length >= 3, `Expected at least 3 phase files, got ${files.length}: ${files.join(', ')}`);

  const { RuleEngine } = require('../src/core');
  const engine = new RuleEngine();

  for (const f of files) {
    const fullPath = path.join(tmpDir, f);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const analysis = engine.analyze(sql, { filename: f });
    assert.equal(
      analysis.violations.length,
      0,
      `Generated file ${f} must have 0 violations, but had: ${JSON.stringify(analysis.violations.map(v => v.ruleId))}`
    );
    assert.equal(analysis.passed, true);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI E2E - Inter-file sharedState context suppresses false positives across migration chain', () => {
  const tmpDir = createTempDir('lockguard-chain-');
  const m1 = path.join(tmpDir, '001_create_orders.sql');
  const m2 = path.join(tmpDir, '002_add_index.sql');

  fs.writeFileSync(m1, `
    SET lock_timeout = '3s';
    CREATE TABLE orders (id serial primary key, amount numeric);
  `, 'utf8');

  fs.writeFileSync(m2, `
    SET lock_timeout = '3s';
    CREATE INDEX idx_orders_amount ON orders (amount);
  `, 'utf8');

  // Without --isolated, table created in 001 suppresses LG-002 in 002
  const res = runCli(['check', tmpDir, '--format=json']);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.summary.passed, true);
  assert.equal(parsed.summary.totalViolations, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI E2E - --isolated flag disables inter-file sharedState', () => {
  const tmpDir = createTempDir('lockguard-isolated-');
  const m1 = path.join(tmpDir, '001_create_orders.sql');
  const m2 = path.join(tmpDir, '002_add_index.sql');

  fs.writeFileSync(m1, `
    SET lock_timeout = '3s';
    CREATE TABLE orders (id serial primary key, amount numeric);
  `, 'utf8');

  fs.writeFileSync(m2, `
    SET lock_timeout = '3s';
    CREATE INDEX idx_orders_amount ON orders (amount);
  `, 'utf8');

  // With --isolated, file 002 does not inherit table creation context from 001
  const res = runCli(['check', tmpDir, '--isolated', '--format=json']);
  assert.equal(res.status, 1);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.summary.passed, false);
  const v = parsed.violations.find(v => v.ruleId === 'LG-002');
  assert.ok(v, 'LG-002 must trigger in isolated mode');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI E2E - --schema-stats enriches analysis with real table metadata', () => {
  const tmpDir = createTempDir('lockguard-stats-');
  const statsFile = path.join(tmpDir, 'stats.json');
  fs.writeFileSync(statsFile, JSON.stringify({
    users: { rowCount: 25000000, sizeMb: 12000 }
  }), 'utf8');

  const sqlFile = path.join(tmpDir, 'migration.sql');
  fs.writeFileSync(sqlFile, `
    SET lock_timeout = '3s';
    CREATE INDEX idx_users_email ON users (email);
  `, 'utf8');

  const res = runCli(['check', sqlFile, `--schema-stats=${statsFile}`, '--format=json']);
  assert.equal(res.status, 1);
  const parsed = JSON.parse(res.stdout);
  const v = parsed.violations[0];
  assert.ok(v.contextualMessage.includes('25.0M rows'));
  assert.ok(v.contextualMessage.includes('11.7 GB'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
