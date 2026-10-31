require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-accounts-http-'));
process.env.LOCKGUARD_DB_FILE = path.join(tmp, 'test.sqlite3');
process.env.NODE_ENV = 'test';
process.env.LOCKGUARD_ADMIN_TOKEN = 'test-operator-only';
process.env.LOCKGUARD_ALLOW_REGISTRATION = 'true';
const server = require('../src/server/server');
const db = require('../src/server/db');
const AuthService = require('../src/server/auth-service');
const password = 'Correct test password 2026';
let a, b, aKey;

async function request(route, { method = 'GET', body, cookie, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null, cookie: res.headers['set-cookie']?.[0].split(';')[0] });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const post = (route, body, cookie, headers) => request(route, { method: 'POST', body, cookie, headers });

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.APP_URL = 'http://127.0.0.1:' + server.address().port;
  a = await post('/api/v1/auth/register', { email: 'Alice@example.invalid', password, organizationName: 'Alice organization' });
  b = await post('/api/v1/auth/register', { email: 'bob@example.invalid', password, organizationName: 'Bob organization', organizationId: a.body.user?.organizationId });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
  aKey = await post('/api/v1/keys', { name: 'Alice CI', organizationId: b.body.user.organizationId }, a.cookie);
  assert.equal(aKey.status, 201);
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('Registration creates independent organizations and stores only salted password/session hashes', async () => {
  assert.notEqual(a.body.user.organizationId, b.body.user.organizationId);
  assert.match(a.headers['set-cookie'][0], /HttpOnly/);
  assert.match(a.headers['set-cookie'][0], /SameSite=Lax/);
  assert.ok(!JSON.stringify(a.body).includes(password));
  assert.ok(!JSON.stringify(a.body).includes('passwordHash'));
  const first = db.getUserByEmail('ALICE@example.invalid'), second = db.getUserByEmail('bob@example.invalid');
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.ok(!first.passwordHash.includes(password));
  assert.equal(db.verifyApiKey('lg_live_demo998877665544332211'), false, 'A known demo key must never be bootstrapped as active');
  const token = a.cookie.split('=')[1];
  assert.notEqual(db.sql.prepare('SELECT token_hash FROM sessions LIMIT 1').get().token_hash, token);
  assert.equal((await request('/api/v1/auth/session', { cookie: a.cookie })).body.user.email, 'alice@example.invalid');
  assert.equal((await request('/api/v1/auth/session')).body.user, null);
  const duplicate = await post('/api/v1/auth/register', { email: 'ALICE@example.invalid', password, organizationName: 'Duplicate' });
  assert.equal(duplicate.status, 409);
});

test('Client sessions cannot enumerate or revoke another organization’s keys or change its settings', async () => {
  assert.equal(aKey.body.key.organizationId, a.body.user.organizationId);
  assert.deepEqual((await request('/api/v1/keys?organizationId=' + a.body.user.organizationId, { cookie: b.cookie })).body.keys, []);
  const denied = await request('/api/v1/keys/' + aKey.body.key.id, { method: 'DELETE', cookie: b.cookie });
  assert.equal(denied.status, 404);
  assert.ok(db.verifyApiKey(aKey.body.key.key));
  assert.equal((await post('/api/v1/organization', { name: 'Bob renamed', id: a.body.user.organizationId }, b.cookie)).status, 200);
  assert.equal((await request('/api/v1/organization', { cookie: a.cookie })).body.organization.name, 'Alice organization');
  assert.equal((await request('/api/v1/organization', { cookie: b.cookie })).body.organization.name, 'Bob renamed');
  assert.equal((await post('/api/v1/organization', { plan: 'business' }, b.cookie)).status, 400);
  assert.equal((await request('/api/v1/keys')).status, 401);
  assert.deepEqual((await request('/api/v1/keys', { headers: { Authorization: 'Bearer test-operator-only' } })).body.keys, []);
});

test('API-key audits and customer histories stay bound to the server-selected organization', async () => {
  const verified = await post('/api/v1/verify-key', { apiKey: aKey.body.key.key });
  assert.equal(verified.body.organization.id, a.body.user.organizationId);
  const audit = await post('/api/v1/analyze', { sql: 'CREATE INDEX ix ON accounts(id);', recordRun: true, repo: 'alice/private', apiKey: aKey.body.key.key, organizationId: b.body.user.organizationId });
  assert.equal(audit.status, 200);
  const saved = (await request('/api/v1/runs', { cookie: a.cookie })).body.runs[0];
  assert.equal(saved.repo, 'alice/private');
  assert.equal(saved.prNumber, null, 'A PR number is not invented');
  assert.equal(saved.markdownReport, audit.body.data.markdownReport, 'The actual report is retained');
  assert.deepEqual((await request('/api/v1/runs', { cookie: b.cookie })).body.runs, []);
  const cross = await post('/api/v1/analyze', { sql: 'SELECT 1;', apiKey: aKey.body.key.key }, b.cookie);
  assert.equal(cross.status, 403);
  assert.equal((await post('/api/v1/billing/checkout', { plan: 'team' }, b.cookie)).status, 403, 'Payment onboarding remains deferred');
  assert.deepEqual((await request('/api/v1/billing/orders', { cookie: b.cookie })).body.orders, []);
});

test('Cross-site mutations and form-style requests cannot use an existing login', async () => {
  assert.equal((await post('/api/v1/keys', { name: 'CSRF' }, a.cookie, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('/api/v1/auth/login', { email: 'alice@example.invalid', password }, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('/api/v1/auth/logout', {}, a.cookie, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request('/api/v1/keys', { cookie: a.cookie })).body.keys.length, 1);
  const headers = {};
  const production = new AuthService(db, { NODE_ENV: 'production', APP_URL: 'https://accounts.example' });
  production.setCookie({ setHeader: (key, value) => { headers[key] = value; } }, 'test-token');
  assert.match(headers['Set-Cookie'], /^__Host-lockguard_session=/);
  assert.match(headers['Set-Cookie'], /; Secure$/);
  assert.ok(!headers['Set-Cookie'].includes('Domain='));
});

test('Password change revokes existing sessions; login rotates cookies and logout is persistent', async () => {
  const login = await post('/api/v1/auth/login', { email: 'alice@example.invalid', password });
  assert.equal(login.status, 200);
  assert.notEqual(login.cookie, a.cookie);
  const replacement = 'New correct test password 2026';
  const changed = await post('/api/v1/auth/password', { currentPassword: password, password: replacement }, a.cookie);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await request('/api/v1/keys', { cookie: login.cookie })).status, 401);
  assert.equal((await post('/api/v1/auth/login', { email: 'alice@example.invalid', password })).status, 401);
  assert.equal((await request('/api/v1/auth/session', { cookie: b.cookie })).body.user.email, 'bob@example.invalid');
  assert.equal((await post('/api/v1/auth/logout', {}, changed.cookie)).status, 200);
  assert.equal((await request('/api/v1/auth/session', { cookie: changed.cookie })).body.user, null);
  const signedIn = await post('/api/v1/auth/login', { email: 'alice@example.invalid', password: replacement });
  assert.equal(signedIn.status, 200);
  const tokenHash = crypto.createHash('sha256').update(signedIn.cookie.split('=')[1]).digest('hex');
  db.sql.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').run(tokenHash);
  assert.equal((await request('/api/v1/keys', { cookie: signedIn.cookie })).status, 401);
});

test('Registration can be disabled and brute-force login attempts are limited', async () => {
  process.env.LOCKGUARD_ALLOW_REGISTRATION = 'false';
  const disabled = await post('/api/v1/auth/register', { email: 'disabled@example.invalid', password, organizationName: 'Disabled' });
  assert.equal(disabled.status, 403);
  process.env.LOCKGUARD_ALLOW_REGISTRATION = 'true';
  let last;
  for (let i = 0; i < 11; i++) last = await post('/api/v1/auth/login', { email: 'unknown@example.invalid', password });
  assert.equal(last.status, 429);
});
