const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

test('The cabinet requires its volume and preserves saved work after restart and container replacement', async () => {
  const id = 'lockguard-ci-' + randomUUID();
  const container = id + '-app';
  const volume = id + '-volume';
  const domain = 'cabinet.example.invalid';
  const origin = 'https://' + domain;
  const env = { ...process.env, LOCKGUARD_BACKUP_KEY: randomBytes(32).toString('base64') };
  const settings = [
    '--env', 'RAILWAY_VOLUME_MOUNT_PATH=/data',
    '--env', 'RAILWAY_PUBLIC_DOMAIN=' + domain,
    '--env', 'LOCKGUARD_BACKUP_KEY',
    '--memory', '475m', '--cpus', '1'
  ];
  const docker = (...args) => execFileSync('docker', args, { env, encoding: 'utf8', timeout: 45000 });
  let base;

  async function launch() {
    docker('run', '-d', '--name', container, '-p', '127.0.0.1::3000', ...settings,
      '--mount', `type=volume,src=${volume},dst=/data`, 'lockguard-web-ci');
    base = 'http://' + docker('port', container, '3000/tcp').trim();
    await waitForCabinet();
  }

  async function waitForCabinet() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const ready = await fetch(base + '/api/v1/rules', { signal: AbortSignal.timeout(1000) })
        .then(response => response.ok, () => false);
      if (ready) return;
      await delay(250);
    }
    assert.fail('Cabinet did not become ready. ' + docker('logs', container));
  }

  async function request(route, { body, cookie, status = 200 } = {}) {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    assert.equal(response.status, status, await response.clone().text());
    return { data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }

  try {
    const noVolume = spawnSync('docker', ['run', '--rm', '--name', id + '-no-volume', ...settings, 'lockguard-web-ci'],
      { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(noVolume.status, 1, noVolume.error?.message || noVolume.stderr);
    assert.match(noVolume.stderr, /Attach a Railway volume at \/data/);

    docker('volume', 'create', volume);
    await launch();
    const credentials = { email: 'durable-test@example.invalid', password: 'Synthetic durability test password' };
    const registered = await request('/api/v1/auth/register', {
      body: { ...credentials, organizationName: 'Synthetic durability test' }, status: 201
    });
    assert.match(registered.cookie, /^__Host-lockguard_session=/);
    // Seed Pro in this disposable volume using the operator's organization store.
    docker('exec', '-e', 'LOCKGUARD_DB_FILE=/data/lockguard.sqlite3', container, 'node', '-e', `
      const db = require('./src/server/db');
      try {
        const user = db.getUserByEmail(process.argv[1]);
        db.forOrganization(user.organizationId).updatePlan('team');
      } finally {
        db.close();
      }
    `, credentials.email);
    const cookie = registered.cookie;
    const schema = await request('/api/v1/schemas', {
      body: {
        name: 'Durability fixture schema',
        sql: 'CREATE TABLE durability_fixture (id bigint PRIMARY KEY, label text);'
      },
      cookie,
      status: 201
    });
    const schemaRoute = '/api/v1/schemas/' + schema.data.profile.id;
    const savedSchema = (await request(schemaRoute, { cookie })).data.profile;
    const sql = "SET lock_timeout='3s'; CREATE INDEX CONCURRENTLY ix_durability_label ON durability_fixture(label);";
    const saved = await request('/api/v1/analyze', {
      body: { sql, filename: 'durability-test.sql', recordRun: true, schemaId: savedSchema.id },
      cookie
    });
    assert.ok(saved.data.data.runId);
    const created = await request('/api/v1/reviews', {
      body: { runId: saved.data.data.runId, title: 'Durability fixture review', sql },
      cookie,
      status: 201
    });
    const reviewRoute = '/api/v1/reviews/' + created.data.review.id;
    const comment = 'Synthetic review note before restart.';
    const savedReview = (await request(reviewRoute + '/events', {
      body: { kind: 'comment', expectedRevision: created.data.review.revision, text: comment },
      cookie
    })).data.review;
    assert.equal(savedReview.events.at(-1).text, comment);
    assert.equal(savedReview.sql, sql);
    assert.equal(savedReview.run.schemaId, savedSchema.id);

    async function verifySavedWork() {
      const signedIn = await request('/api/v1/auth/login', { body: credentials });
      assert.equal(signedIn.data.user.id, registered.data.user.id);
      assert.equal(signedIn.data.user.organizationId, registered.data.user.organizationId);
      const auth = { cookie: signedIn.cookie };
      const [history, schemaResult, reviewResult] = await Promise.all([
        request('/api/v1/runs', auth), request(schemaRoute, auth), request(reviewRoute, auth)
      ]);
      const run = history.data.runs.find(run => run.id === saved.data.data.runId);
      assert.equal(run?.schemaId, savedSchema.id);
      assert.deepEqual(schemaResult.data.profile, savedSchema);
      assert.deepEqual(reviewResult.data.review, savedReview);
    }

    docker('restart', container);
    await waitForCabinet();
    await verifySavedWork();
    docker('stop', container);
    docker('rm', container);
    await launch();
    await verifySavedWork();
  } finally {
    spawnSync('docker', ['rm', '-f', container, id + '-no-volume'], { timeout: 15000, stdio: 'ignore' });
    spawnSync('docker', ['volume', 'rm', volume], { timeout: 15000, stdio: 'ignore' });
  }
});
