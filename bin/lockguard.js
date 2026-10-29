#!/usr/bin/env node

const LockGuardCLI = require('../src/cli/cli');

try {
  const exitCode = LockGuardCLI.run(process.argv.slice(2));
  process.exit(exitCode);
} catch (err) {
  console.error('Fatal LockGuard CLI error:', err);
  process.exit(2);
}
