const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
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
