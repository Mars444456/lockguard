#!/usr/bin/env node

const LockGuardCLI = require('../src/cli/cli');

(async () => {
  try {
    await require('../src/core/pg-parser').initialize();
    const exitCode = await LockGuardCLI.run(process.argv.slice(2));
    if (typeof exitCode === 'number') {
      process.exitCode = exitCode;
    } else {
      process.exitCode = exitCode ? 1 : 0;
    }
  } catch (err) {
    console.error('Fatal LockGuard CLI error:', err);
    process.exitCode = 2;
  }
})();
