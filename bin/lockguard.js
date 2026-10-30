#!/usr/bin/env node

const LockGuardCLI = require('../src/cli/cli');

(async () => {
  try {
    const exitCode = await LockGuardCLI.run(process.argv.slice(2));
    if (typeof exitCode === 'number') {
      process.exit(exitCode);
    } else {
      process.exit(exitCode ? 1 : 0);
    }
  } catch (err) {
    console.error('Fatal LockGuard CLI error:', err);
    process.exit(2);
  }
})();
