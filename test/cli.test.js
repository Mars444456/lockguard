require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LockGuardCLI = require('../src/cli/cli');

test('CLI - runs rules command successfully', () => {
  const code = LockGuardCLI.run(['rules']);
  assert.equal(code, 0);
});

test('CLI - check on safe migration exits with code 0', () => {
  const safeFile = path.join(__dirname, '../fixtures/10_safe_migration.sql');
  const code = LockGuardCLI.run(['check', safeFile, '--format=table']);
  assert.equal(code, 0);
});

test('CLI - check on catastrophic migration exits with code 1 (blocks release)', () => {
  const badFile = path.join(__dirname, '../fixtures/09_catastrophic_combined.sql');
  const code = LockGuardCLI.run(['check', badFile, '--format=json']);
  assert.equal(code, 1);
});

test('CLI - check with github-pr-comment format generates valid markdown', () => {
  const badFile = path.join(__dirname, '../fixtures/01_dangerous_add_column.sql');
  const code = LockGuardCLI.run(['check', badFile, '--format=github-pr-comment']);
  assert.equal(code, 1);
});

test('CLI - check with sarif format outputs valid SARIF JSON', () => {
  const safeFile = path.join(__dirname, '../fixtures/10_safe_migration.sql');
  const tmpOutput = path.join(os.tmpdir(), `lockguard-sarif-${Date.now()}.sarif`);
  
  const code = LockGuardCLI.run(['check', safeFile, '--format=sarif', `--output=${tmpOutput}`]);
  assert.equal(code, 0);

  const sarifRaw = fs.readFileSync(tmpOutput, 'utf8');
  const sarif = JSON.parse(sarifRaw);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].tool.driver.name, 'LockGuard');
  fs.unlinkSync(tmpOutput);
});

test('CLI - auto-fix flag applies safe lock_timeout and CONCURRENTLY', () => {
  const tmpFile = path.join(os.tmpdir(), `lockguard-fix-${Date.now()}.sql`);
  const initialSql = `CREATE INDEX idx_tmp_test ON accounts(email);`;
  fs.writeFileSync(tmpFile, initialSql, 'utf8');

  // Run with --fix
  LockGuardCLI.run(['check', tmpFile, '--fix']);

  const fixedSql = fs.readFileSync(tmpFile, 'utf8');
  assert.ok(fixedSql.includes("SET lock_timeout = '3s';"));
  assert.ok(fixedSql.includes("CREATE INDEX CONCURRENTLY idx_tmp_test ON accounts(email);"));
  fs.unlinkSync(tmpFile);
});
