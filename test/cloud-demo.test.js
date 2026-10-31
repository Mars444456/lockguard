const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { cloudSettings } = require('../scripts/cloud-demo-server');

test('Cloud demo isolates credentials, production storage and proxy trust while using the public HTTPS origin', () => {
  const settings = cloudSettings({ RENDER_EXTERNAL_URL: 'https://demo.example.invalid', PORT: '10000',
    LOCKGUARD_ADMIN_TOKEN: 'private', ROBOKASSA_PASSWORD_1: 'private', LOCKGUARD_DB_FILE: 'production.sqlite3',
    DEFAULT_API_KEY: 'private', NODE_OPTIONS: '--inspect', LOCKGUARD_TRUST_PROXY_IPS: '*', PATH: 'test-path' }, '/runtime');
  assert.equal(settings.APP_URL, 'https://demo.example.invalid');
  assert.equal(settings.NODE_ENV, 'production');
  assert.equal(settings.LOCKGUARD_EPHEMERAL_DEMO, 'true');
  assert.equal(settings.LOCKGUARD_DB_FILE, path.join('/runtime', 'test.sqlite3'));
  assert.equal(settings.PATH, 'test-path');
  for (const key of ['LOCKGUARD_ADMIN_TOKEN', 'ROBOKASSA_PASSWORD_1', 'DEFAULT_API_KEY', 'NODE_OPTIONS']) assert.equal(settings[key], undefined);
  assert.notEqual(settings.LOCKGUARD_TRUST_PROXY_IPS, '*');
});

test('Cloud demo refuses missing or unsafe public origins and invalid ports before starting', () => {
  for (const url of [undefined, 'http://demo.example.invalid', 'https://user:password@demo.example.invalid', 'https://demo.example.invalid/path']) {
    assert.throws(() => cloudSettings({ RENDER_EXTERNAL_URL: url }, '/runtime'));
  }
  assert.throws(() => cloudSettings({ RENDER_EXTERNAL_URL: 'https://demo.example.invalid', PORT: '0' }, '/runtime'));
});
