const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { cloudSettings } = require('../scripts/cloud-demo-server');

test('Cloud demo isolates credentials, production storage and proxy trust while using the public HTTPS origin', () => {
  const settings = cloudSettings({ RENDER_EXTERNAL_URL: 'https://demo.example.invalid', PORT: '10000',
    LOCKGUARD_ADMIN_TOKEN: 'private', ROBOKASSA_PASSWORD_1: 'private', LOCKGUARD_DB_FILE: 'production.sqlite3',
    DEFAULT_API_KEY: 'private', NODE_OPTIONS: '--inspect', LOCKGUARD_TRUST_PROXY_IPS: '*', PATH: 'test-path' }, '/runtime');
  assert.equal(settings.APP_URL, 'https://demo.example.invalid');
  assert.equal(settings.NODE_ENV, 'production');
  assert.equal(settings.LOCKGUARD_EPHEMERAL_DEMO, 'true');
  assert.equal(settings.UV_THREADPOOL_SIZE, '1');
  assert.equal(settings.MALLOC_ARENA_MAX, '2');
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

test('Render startup keeps repeated SQL parsing below the free memory budget without optimizing Wasm', () => {
  const root = path.resolve(__dirname, '..');
  const command = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8').match(/^\s+startCommand: node (.+)$/m)[1].trim().split(/\s+/);
  assert.equal(command.pop(), 'scripts/cloud-demo-server.js');
  // The SET statement reaches a large PostgreSQL grammar function. With only
  // --no-wasm-tier-up, dynamic TurboFan compilation still allocates >580 MiB.
  const source = `
    const assert = require('node:assert/strict');
    const { setTimeout: delay } = require('node:timers/promises');
    const Engine = require('./src/core/rule-engine');
    (async () => {
      await Engine.initialize();
      const engine = new Engine();
      for (let i = 0; i < 6; i++) {
        const result = engine.analyze("SET lock_timeout='3s'; CREATE INDEX ix ON orders(id);");
        assert.ok(result.violations.some(v => v.ruleId === 'LG-002'));
        await delay(150);
      }
      await delay(1000);
      console.log('PEAK_RSS_KIB=' + process.resourceUsage().maxRSS);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const child = spawnSync(process.execPath, [...command, '--trace-wasm-compilation-times', '-e', source],
    { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(child.status, 0, child.error?.message || child.stderr);
  assert.doesNotMatch(child.stdout, /using TurboFan/);
  const peak = Number(child.stdout.match(/PEAK_RSS_KIB=(\d+)/)?.[1]);
  assert.ok(peak > 0 && peak < 256 * 1024, `Parser peak RSS ${peak} KiB leaves insufficient headroom on Render Free.`);
});
