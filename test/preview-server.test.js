const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { previewSettings } = require('../scripts/preview-server');

test('The public test server uses its own database and does not inherit production secrets', () => {
  const runtime = path.resolve('private/test-runtime');
  const env = previewSettings('https://example.trycloudflare.com', runtime, 3001, {
    Path: 'system-path', SystemRoot: 'system-root', TEMP: 'temp',
    LOCKGUARD_DB_FILE: 'real.sqlite3', LOCKGUARD_ADMIN_TOKEN: 'private-admin',
    ROBOKASSA_PASSWORD1: 'private-password', GITHUB_TOKEN: 'private-github',
    TELEGRAM_BOT_TOKEN: 'private-bot', NODE_OPTIONS: '--require=private.js'
  });
  assert.equal(env.LOCKGUARD_DB_FILE, path.join(runtime, 'test.sqlite3'));
  assert.equal(env.APP_URL, 'https://example.trycloudflare.com');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.Path, 'system-path');
  for (const key of ['LOCKGUARD_ADMIN_TOKEN', 'ROBOKASSA_PASSWORD1', 'GITHUB_TOKEN', 'TELEGRAM_BOT_TOKEN', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
});

test('The test launcher rejects HTTP and ambiguous account origins before starting', () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1', 'https://example.com/#account']) {
    assert.throws(() => previewSettings(url, '.', 3001));
  }
  for (const port of [80, -1, 65536, NaN]) assert.throws(() => previewSettings('https://example.com', '.', port));
});
