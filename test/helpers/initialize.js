// Keep paid-plan regression coverage while production defaults to the free beta.
process.env.LOCKGUARD_FREE_BETA = 'false';
require('node:test').before(() => require('../../src/core/pg-parser').initialize());
