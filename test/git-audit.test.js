require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const CLI = require('../src/cli/cli');
const GitHook = require('../src/cli/git-hook');
const PgParser = require('../src/core/pg-parser');
const cliPath = path.resolve(__dirname, '../bin/lockguard.js');
const ciPath = path.resolve(__dirname, '../scripts/check-pr-migrations.js');
const safe = "SET lock_timeout = '3s'; CREATE INDEX CONCURRENTLY idx_a ON accounts(id);";
const unsafe = 'CREATE INDEX idx_a ON accounts(id);';

function workspace(t, repository = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-git-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (repository) git(directory, ['init']);
  return directory;
}
function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.name=LockGuard Test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}
function cli(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
}

test('Staged audit blocks unsafe index contents even when the working copy is safe', t => {
  const cwd = workspace(t);
  const name = 'миграция с пробелом.sql';
  fs.writeFileSync(path.join(cwd, name), unsafe);
  git(cwd, ['add', '--', name]);
  fs.writeFileSync(path.join(cwd, name), safe);
  const result = cli(cwd, ['check', '--staged', '--format=json']);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(JSON.parse(result.stdout).violations.some(v => v.ruleId === 'LG-002'));
  assert.equal(cli(cwd, ['hook']).status, 1);
});

test('Staged audit reads safe staged files even after their working copies are removed', t => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'migration.sql'), safe);
  git(cwd, ['add', 'migration.sql']);
  fs.unlinkSync(path.join(cwd, 'migration.sql'));
  const result = cli(cwd, ['check', '--staged', '--format=json']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).summary.passed);
  assert.ok(!result.stdout.includes('No staged'));
});

test('Staged checks fail closed outside Git and refuse auto-fix of the index', t => {
  const cwd = workspace(t, false);
  assert.equal(cli(cwd, ['check', '--staged']).status, 2);
  assert.equal(cli(cwd, ['hook']).status, 2);
  const repo = workspace(t);
  fs.writeFileSync(path.join(repo, 'migration.sql'), unsafe);
  git(repo, ['add', 'migration.sql']);
  assert.equal(cli(repo, ['check', '--staged', '--fix']).status, 2);
  assert.equal(git(repo, ['show', ':migration.sql']), unsafe);
  assert.equal(fs.readFileSync(path.join(repo, 'migration.sql'), 'utf8'), unsafe);
});

test('Hook installation preserves an existing pre-commit hook', t => {
  const cwd = workspace(t);
  const file = path.join(cwd, '.git/hooks/pre-commit');
  fs.writeFileSync(file, '#!/bin/sh\necho existing-check\n');
  assert.throws(() => GitHook.installHook(cwd), /already exists/);
  assert.ok(fs.readFileSync(file, 'utf8').includes('existing-check'));
});

test('Auto-fix preserves string data, comments and function bodies, using UTF-8 SQL offsets', t => {
  const cwd = workspace(t, false);
  const file = path.join(cwd, 'migration.sql');
  const literal = "SELECT 'Привет: CREATE INDEX stored ON accounts(id)'";
  const body = "DO $$ BEGIN RAISE NOTICE 'CREATE INDEX kept ON accounts(id)'; END $$";
  fs.writeFileSync(file, `${literal};\n${body};\nCREATE /* note */ UNIQUE\nINDEX real_index ON accounts(id);`);
  CLI.applyAutoFix(file);
  const fixed = fs.readFileSync(file, 'utf8');
  assert.ok(fixed.includes(literal));
  assert.ok(fixed.includes(body));
  assert.ok(fixed.includes('CREATE /* note */ UNIQUE\nINDEX CONCURRENTLY real_index'));
  assert.ok(PgParser.parse(fixed).some(s => s.pgKind === 'IndexStmt' && s.isConcurrent));
});

test('Invalid auto-fix timeout cannot inject SQL or overwrite the migration', t => {
  const cwd = workspace(t, false);
  const file = path.join(cwd, 'migration.sql');
  fs.writeFileSync(file, unsafe);
  assert.throws(() => CLI.applyAutoFix(file, "3s'; DROP TABLE accounts; --"), /positive duration/);
  assert.equal(fs.readFileSync(file, 'utf8'), unsafe);
});

test('PR gate audits actual changed migrations and excludes test fixtures', t => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'README.md'), 'test');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'base']);
  const base = git(cwd, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(cwd, 'migrations'));
  fs.mkdirSync(path.join(cwd, 'fixtures'));
  fs.writeFileSync(path.join(cwd, 'migrations/real change.sql'), unsafe);
  fs.writeFileSync(path.join(cwd, 'fixtures/example.sql'), 'NOT VALID SQL');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'migration']);
  const result = spawnSync(process.execPath, [ciPath], { cwd, encoding: 'utf8', env: { ...process.env, LOCKGUARD_BASE_SHA: base } });
  assert.equal(result.status, 1, result.stderr);
  const report = fs.readFileSync(path.join(cwd, 'lockguard-pr-report.md'), 'utf8');
  assert.ok(report.includes('real change.sql'));
  assert.ok(report.includes('LG-002'));
  assert.ok(!report.includes('example.sql'));
});
