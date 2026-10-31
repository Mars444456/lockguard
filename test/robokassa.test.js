require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-robokassa-'));
process.env.LOCKGUARD_DB_FILE = path.join(tmp, 'server.json');
const mainDatabase = require('../src/server/db');
const { PersistentDatabase } = mainDatabase;
const connections = [mainDatabase];
const Robokassa = require('../src/server/robokassa-provider');
const env = { ROBOKASSA_MERCHANT_LOGIN: 'qa-shop', ROBOKASSA_TEST_MODE: 'false', ROBOKASSA_HASH_ALGORITHM: 'sha256',
  ROBOKASSA_PASSWORD1: 'qa-live-first', ROBOKASSA_PASSWORD2: 'qa-live-second',
  ROBOKASSA_TEST_PASSWORD1: 'qa-test-first', ROBOKASSA_TEST_PASSWORD2: 'qa-test-second' };
test.after(() => { for (const db of connections) db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
function fixture(options = {}) {
  const db = new PersistentDatabase({ memoryOnly: true, ...options });
  connections.push(db);
  const provider = new Robokassa({ db, env: { ...env } });
  return { db, provider };
}
function buy(provider, plan = 'team', requestId = crypto.randomUUID()) {
  return provider.checkout({ plan, email: 'buyer@example.com', requestId });
}
function callback(provider, orderId, amount = '1500.000000', password) {
  const order = provider.db.getPaymentOrder(orderId);
  const credentials = provider.credentials(order?.testMode);
  return { InvId: orderId, OutSum: amount, SignatureValue: crypto.createHash(credentials.algorithm)
    .update(`${amount}:${orderId}:${password || credentials.password2}`).digest('hex') };
}
test('Robokassa signs the server-priced invoice and receipt, keeping passwords private', () => {
  const { db, provider } = fixture();
  const checkout = buy(provider);
  const fields = checkout.paymentForm.fields;
  assert.equal(checkout.currency, 'RUB'); assert.equal(fields.OutSum, '1500.00');
  const receipt = JSON.parse(decodeURIComponent(fields.Receipt));
  assert.equal(receipt.items[0].sum, 1500);
  assert.equal(fields.SignatureValue, crypto.createHash('sha256').update(`qa-shop:1500.00:${fields.InvId}:${fields.Receipt}:qa-live-first`).digest('hex'));
  assert.ok(!JSON.stringify(checkout).includes(env.ROBOKASSA_PASSWORD1));
  assert.equal(db.getOrganization().plan, 'free');
  assert.equal(db.getPaymentOrder(checkout.orderId).status, 'pending');
});
test('Checkout idempotency persists the same invoice, rejects parameter changes', () => {
  const { provider, db } = fixture();
  const requestId = crypto.randomUUID();
  assert.equal(buy(provider, 'team', requestId).orderId, buy(provider, 'team', requestId).orderId);
  assert.equal(db.getPaymentOrders().length, 1);
  assert.throws(() => buy(provider, 'business', requestId), /idempotency/);
});
test('Callback signature, amount, invoice and password number are validated', () => {
  const { provider, db } = fixture();
  const checkout = buy(provider);
  assert.throws(() => provider.process(callback(provider, checkout.orderId, '1.00')), /Сумма/);
  assert.throws(() => provider.process(callback(provider, checkout.orderId, '1500.000001')), /точность/);
  assert.throws(() => provider.process(callback(provider, checkout.orderId, '1500.00', env.ROBOKASSA_PASSWORD1)), /подпись/);
  assert.throws(() => provider.process({ ...callback(provider, checkout.orderId), SignatureValue: 'bad' }), /подпись/);
  assert.throws(() => provider.process({ InvId: '999', OutSum: '1500.00', SignatureValue: 'bad' }), /не найден/);
  assert.equal(db.getOrganization().plan, 'free');
});
test('Successful callback grants 30 days once, and next payment extends access', () => {
  const { provider, db } = fixture();
  const checkout = buy(provider);
  const notification = callback(provider, checkout.orderId);
  assert.equal(provider.process(notification), `OK${checkout.orderId}`);
  const firstExpiry = Date.parse(db.getOrganization().accessUntil);
  assert.equal(db.getOrganization().plan, 'team');
  assert.ok(firstExpiry > Date.now() + 29 * 86400000);
  provider.process(notification);
  assert.equal(Date.parse(db.getOrganization().accessUntil), firstExpiry);
  provider.process(callback(provider, buy(provider).orderId));
  assert.equal(Date.parse(db.getOrganization().accessUntil), firstExpiry + 30 * 86400000);
});
test('Test mode uses separate secrets and cannot grant production access', () => {
  const { provider, db } = fixture();
  provider.env.ROBOKASSA_TEST_MODE = 'true';
  const checkout = buy(provider);
  assert.equal(checkout.paymentForm.fields.IsTest, '1');
  assert.throws(() => provider.process(callback(provider, checkout.orderId, '1500.00', env.ROBOKASSA_PASSWORD2)), /подпись/);
  provider.process(callback(provider, checkout.orderId));
  assert.equal(db.getPaymentOrder(checkout.orderId).status, 'test_paid');
  assert.equal(db.getOrganization().plan, 'free');
});
test('A business audit is an order awaiting delivery, not a recurring subscription', () => {
  const { provider, db } = fixture();
  const checkout = buy(provider, 'business');
  provider.process(callback(provider, checkout.orderId, '30000.000000'));
  assert.equal(db.getPaymentOrder(checkout.orderId).fulfillmentStatus, 'awaiting_audit');
  assert.equal(db.getOrganization().plan, 'free');
});
test('Paid invoices and replay protection survive database restart', () => {
  const dbFilePath = path.join(tmp, 'restart.json');
  const original = fixture({ memoryOnly: false, dbFilePath });
  const checkout = buy(original.provider);
  original.provider.process(callback(original.provider, checkout.orderId));
  const expiry = original.db.getOrganization().accessUntil;
  const reloaded = fixture({ memoryOnly: false, dbFilePath });
  reloaded.provider.process(callback(reloaded.provider, checkout.orderId));
  assert.equal(reloaded.db.getOrganization().accessUntil, expiry);
  assert.notEqual(buy(reloaded.provider).orderId, checkout.orderId);
});
test('Expired access reverts to free without an automatic debit', t => {
  const { provider, db } = fixture();
  provider.process(callback(provider, buy(provider).orderId));
  const expiry = Date.parse(db.getOrganization().accessUntil);
  t.mock.method(Date, 'now', () => expiry + 1);
  assert.equal(db.getOrganization().plan, 'free');
  assert.equal(db.getOrganization().subscriptionStatus, 'expired');
  assert.equal(db.getPaymentOrders().length, 1);
});
test('Failed persistence does not acknowledge payment or leave a partially granted entitlement', () => {
  const dbFilePath = path.join(tmp, 'failed-payment.json');
  const { db, provider } = fixture({ memoryOnly: false, dbFilePath });
  const checkout = buy(provider);
  const notification = callback(provider, checkout.orderId);
  db.sql.exec("CREATE TRIGGER reject_entitlement BEFORE UPDATE ON organizations BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END");
  assert.throws(() => provider.process(notification), /Unable to save/);
  assert.equal(db.getOrganization().plan, 'free');
  assert.equal(db.getPaymentOrder(checkout.orderId).status, 'pending');
  db.sql.exec('DROP TRIGGER reject_entitlement');
  assert.equal(provider.process(notification), `OK${checkout.orderId}`);
  assert.equal(db.getOrganization().plan, 'team');
});
test('Missing merchant configuration fails explicitly and creates no invoice', () => {
  const { db } = fixture();
  const provider = new Robokassa({ db, env: {} });
  assert.throws(() => buy(provider), error => error.statusCode === 503);
  assert.equal(db.getPaymentOrders().length, 0);
});
test('HTTP: ResultURL accepts signed forms, rejects duplicates, and return pages cannot activate orders', async () => {
  const before = {};
  for (const key of Object.keys(env)) { before[key] = process.env[key]; process.env[key] = env[key]; }
  const oldAdmin = process.env.LOCKGUARD_ADMIN_TOKEN;
  process.env.LOCKGUARD_ADMIN_TOKEN = 'qa-admin';
  const db = require('../src/server/db');
  const provider = new Robokassa();
  const checkout = buy(provider);
  const server = require('../src/server/server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  async function request(route, method = 'GET', body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method, headers }, res => {
        let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text }));
      }); req.on('error', reject); req.end(body);
    });
  }
  try {
    assert.equal((await request('/billing/success?InvId=' + checkout.orderId)).status, 303);
    assert.equal(db.getOrganization().plan, 'free');
    assert.equal((await request('/api/v1/billing/orders')).status, 401);
    const form = new URLSearchParams(callback(provider, checkout.orderId)).toString();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
    assert.equal((await request('/api/v1/billing/robokassa/result', 'POST', form + '&OutSum=1', headers)).status, 400);
    const result = await request('/api/v1/billing/robokassa/result', 'POST', form, headers);
    assert.equal(result.status, 200); assert.equal(result.text, `OK${checkout.orderId}`);
    assert.equal(db.getOrganization().plan, 'team');
    const orders = await request('/api/v1/billing/orders', 'GET', undefined, { Authorization: 'Bearer qa-admin' });
    assert.equal(JSON.parse(orders.text).orders[0].status, 'paid');
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const key of Object.keys(env)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
    if (oldAdmin === undefined) delete process.env.LOCKGUARD_ADMIN_TOKEN; else process.env.LOCKGUARD_ADMIN_TOKEN = oldAdmin;
  }
});
