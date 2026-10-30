const test = require('node:test');
const assert = require('node:assert/strict');
const registerRoutes = require('../src/server/routes');
const db = require('../src/server/db-mock');

function createMockRouter() {
  const routes = [];
  return {
    routes,
    get(path, handler) { routes.push({ method: 'GET', path, handler }); },
    post(path, handler) { routes.push({ method: 'POST', path, handler }); },
    delete(path, handler) { routes.push({ method: 'DELETE', path, handler }); }
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    }
  };
  return res;
}

test('Routes - POST /api/v1/analyze returns analysis and markdown', async () => {
  const router = createMockRouter();
  registerRoutes(router);

  const route = router.routes.find(r => r.method === 'POST' && r.path === '/api/v1/analyze');
  assert.ok(route);

  const req = {
    body: {
      sql: "SET lock_timeout = '3s';\nCREATE INDEX idx_users_email ON users (email);"
    }
  };
  const res = createMockRes();

  await route.handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.data.passed, false);
  assert.equal(res.data.data.highestLockLevel, 'SHARE');
  assert.ok(res.data.data.markdownReport.includes('MERGE BLOCKED'));
});

test('Routes - GET /api/v1/rules returns all rules catalog', async () => {
  const router = createMockRouter();
  registerRoutes(router);

  const route = router.routes.find(r => r.method === 'GET' && r.path === '/api/v1/rules');
  const req = {};
  const res = createMockRes();

  await route.handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.count, 12);
});

test('Routes - POST /api/v1/verify-key validates license token', async () => {
  const router = createMockRouter();
  registerRoutes(router);

  const route = router.routes.find(r => r.method === 'POST' && r.path === '/api/v1/verify-key');
  const req = { body: { apiKey: 'lg_live_demo998877665544332211' } };
  const res = createMockRes();

  await route.handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.valid, true);
});

test('Routes - POST /api/v1/billing/checkout upgrades plan', async () => {
  const router = createMockRouter();
  registerRoutes(router);

  const route = router.routes.find(r => r.method === 'POST' && r.path === '/api/v1/billing/checkout');
  const req = { body: { plan: 'business' } };
  const res = createMockRes();

  await route.handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.plan, 'business');
  assert.equal(res.data.amount, 99);
  assert.equal(db.getOrganization().plan, 'business');
});
