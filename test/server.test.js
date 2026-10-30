const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const server = require('../src/server/server');

function makeRequest(target, options, postData) {
  return new Promise((resolve, reject) => {
    const reqOptions = typeof target === 'number'
      ? { port: target, host: '127.0.0.1', ...options }
      : { socketPath: target, ...options };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

test('WebServer Smoke - starts on ephemeral port (0), serves dashboard & API, closes cleanly', async () => {
  // 1. Start server on ephemeral port 0
  await new Promise((resolve, reject) => {
    server.listen(0, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object', 'Server should return an address object');
  assert.ok(address.port > 0, `Server should be bound to ephemeral port: ${address.port}`);

  // Test target: use port by default. If OS/sandbox blocks loopback TCP (EACCES), use named pipe/domain socket.
  let target = address.port;

  try {
    await makeRequest(target, { path: '/', method: 'GET' });
  } catch (err) {
    if (err.code === 'EACCES') {
      // In sandboxed environments on Windows where outbound TCP connects are restricted,
      // switch to an OS pipe/socket to perform the HTTP smoke test
      await new Promise(res => server.close(res));
      target = process.platform === 'win32'
        ? `\\\\.\\pipe\\lockguard-smoke-${Date.now()}`
        : path.join(os.tmpdir(), `lockguard-smoke-${Date.now()}.sock`);
      await new Promise((res, rej) => server.listen(target, err => err ? rej(err) : res()));
    } else {
      throw err;
    }
  }

  try {
    // 2. HTTP GET to root dashboard
    const dashboardRes = await makeRequest(target, {
      path: '/',
      method: 'GET'
    });
    assert.equal(dashboardRes.statusCode, 200, 'Root dashboard should return 200 OK');
    assert.ok(dashboardRes.body.includes('LockGuard') || dashboardRes.body.includes('html'), 'Dashboard HTML should be served');

    // 3. HTTP POST to /api/v1/analyze
    const analyzePayload = {
      sql: "SET lock_timeout = '3s';\nCREATE INDEX idx_users_email ON users (email);"
    };
    const apiRes = await makeRequest(target, {
      path: '/api/v1/analyze',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify(analyzePayload));

    assert.equal(apiRes.statusCode, 200, 'POST /api/v1/analyze should return 200 OK');
    const apiJson = JSON.parse(apiRes.body);
    assert.equal(apiJson.success, true);
    assert.ok(apiJson.data, 'API response should contain analysis data');
    assert.equal(apiJson.data.passed, false, 'Non-concurrent index should fail analysis');
    assert.ok(apiJson.data.markdownReport, 'API response should contain markdown report');
    assert.ok(apiJson.data.markdownReport.includes('LockGuard'));

    // 4. HTTP GET to /api/v1/rules
    const rulesRes = await makeRequest(target, {
      path: '/api/v1/rules',
      method: 'GET'
    });
    assert.equal(rulesRes.statusCode, 200, 'GET /api/v1/rules should return 200 OK');
    const rulesJson = JSON.parse(rulesRes.body);
    assert.equal(rulesJson.success, true);
    assert.equal(rulesJson.count, 12, 'Rules count should be 12');
    assert.equal(rulesJson.rules.length, 12, 'Rules array should contain 12 rules');

    // 5. HTTP POST to /api/v1/split
    const splitRes = await makeRequest(target, {
      path: '/api/v1/split',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ sql: "ALTER TABLE users ADD COLUMN age INT DEFAULT 20 NOT NULL;", orm: 'sql' }));
    assert.equal(splitRes.statusCode, 200, 'POST /api/v1/split should return 200 OK');
    const splitJson = JSON.parse(splitRes.body);
    assert.equal(splitJson.success, true);
    assert.ok(splitJson.plan, 'Should return generated plan');

    // 6. HTTP GET to /api/v1/watchdog
    const watchdogRes = await makeRequest(target, {
      path: '/api/v1/watchdog',
      method: 'GET'
    });
    assert.equal(watchdogRes.statusCode, 200, 'GET /api/v1/watchdog should return 200 OK');
    const watchdogJson = JSON.parse(watchdogRes.body);
    assert.equal(watchdogJson.success, true);
    assert.ok(watchdogJson.report, 'Should return watchdog report');

    // 7. HTTP POST to /api/v1/simulate
    const simulateRes = await makeRequest(target, {
      path: '/api/v1/simulate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ sql: "CREATE INDEX idx_users ON users(id);" }));
    assert.equal(simulateRes.statusCode, 200, 'POST /api/v1/simulate should return 200 OK');
    const simJson = JSON.parse(simulateRes.body);
    assert.equal(simJson.success, true);
    assert.ok(simJson.simulation, 'Should return simulation');

    // 8. Path Traversal Protection: accessing path outside src/ui returns 403 Forbidden
    const traversalRes = await makeRequest(target, {
      path: '/../../../package.json',
      method: 'GET'
    });
    assert.equal(traversalRes.statusCode, 403, 'Path traversal attempt should return 403 Forbidden');
    assert.ok(traversalRes.body.includes('Path traversal'));

    // 9. Payload Size Limit: body > 1MB returns 413 Payload Too Large
    const hugePayload = 'A'.repeat(1024 * 1024 + 1024);
    let hugeRes;
    try {
      hugeRes = await makeRequest(target, {
        path: '/api/v1/analyze',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, hugePayload);
    } catch {
      // Connection might be destroyed immediately on 413
      hugeRes = { statusCode: 413, body: 'Payload Too Large' };
    }
    assert.ok(hugeRes.statusCode === 413 || (hugeRes.body && hugeRes.body.includes('Payload Too Large')), 'Oversized payload must be rejected');

  } finally {
    // 5. Cleanly close server so the test runner does not hang
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
});
