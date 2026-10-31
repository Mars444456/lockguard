const test = require('node:test');
const assert = require('node:assert/strict');
const Auth = require('../src/server/auth-service');

test('Isolated password derivation is compatible with existing hashes and rejects wrong passwords', async t => {
  const previous = process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES;
  t.after(() => { if (previous === undefined) delete process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES; else process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES = previous; });
  delete process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES;
  const old = await Auth.hashPassword('Synthetic compatibility password 2026');
  process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES = 'true';
  assert.equal(await Auth.verifyPassword('Synthetic compatibility password 2026', old), true);
  assert.equal(await Auth.verifyPassword('Wrong synthetic password 2026', old), false);
  const current = await Auth.hashPassword('Synthetic compatibility password 2026');
  assert.match(current, /^scrypt\$32768\$8\$3\$/);
  delete process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES;
  assert.equal(await Auth.verifyPassword('Synthetic compatibility password 2026', current), true);
});

test('Constrained password workers reject excess concurrent work and accept the next request after exit', async t => {
  const previous = process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES;
  process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES = 'true';
  t.after(() => { if (previous === undefined) delete process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES; else process.env.LOCKGUARD_ISOLATE_PASSWORD_HASHES = previous; });
  const pending = Auth.hashPassword('Synthetic bounded password 2026');
  await assert.rejects(Auth.hashPassword('Another synthetic password 2026'), error => error.statusCode === 429);
  const stored = await pending;
  assert.equal(await Auth.verifyPassword('Synthetic bounded password 2026', stored), true);
});
