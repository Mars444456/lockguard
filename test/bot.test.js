const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAuditMessage, generateLicenseKey } = require('../bin/bot.js');
const { RuleEngine } = require('../src/core');

test('Telegram Bot - generateLicenseKey formats valid Pro token', () => {
  const key = generateLicenseKey();
  assert.ok(key.startsWith('LG-PRO-2026-'));
  const parts = key.split('-');
  assert.equal(parts.length, 6);
});

test('Telegram Bot - formatAuditMessage returns 100% safe status for clean migration', () => {
  const engine = new RuleEngine();
  const safeSql = `SET lock_timeout = '3s';\nALTER TABLE users ADD COLUMN bio text;`;
  const analysis = engine.analyze(safeSql, { filename: 'safe.sql' });
  const msg = formatAuditMessage(analysis, safeSql);

  assert.ok(msg.includes('100% ZERO-DOWNTIME SAFE'));
  assert.ok(msg.includes('LockGuard: Аудит PostgreSQL миграции'));
  assert.ok(msg.includes('mars444456.github.io/lockguard'));
});

test('Telegram Bot - formatAuditMessage returns outage warning for dangerous locks', () => {
  const engine = new RuleEngine();
  const badSql = `ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT now();\nCREATE INDEX idx_orders_user ON orders(user_id);`;
  const analysis = engine.analyze(badSql, { filename: 'bad.sql' });
  const msg = formatAuditMessage(analysis, badSql);

  assert.ok(msg.includes('ОБНАРУЖЕНЫ ОПАСНЫЕ БЛОКИРОВКИ'));
  assert.ok(msg.includes('ДЕПЛОЙ ЗАБЛОКИРОВАН'));
  assert.ok(msg.includes('LG-001') || msg.includes('LG-002') || msg.includes('LG-008'));
  assert.ok(msg.includes('Безопасная замена:'));
});
