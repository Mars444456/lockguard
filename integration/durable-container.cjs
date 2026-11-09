const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

test('The cabinet requires its volume and retains an account and saved audit after container replacement', async () => {
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
    const saved = await request('/api/v1/analyze', {
      body: { sql: 'SELECT 1;', filename: 'durability-test.sql', recordRun: true },
      cookie: registered.cookie
    });
    assert.ok(saved.data.data.runId);

    docker('stop', container);
    docker('rm', container);
    await launch();
    const signedIn = await request('/api/v1/auth/login', { body: credentials });
    assert.equal(signedIn.data.user.id, registered.data.user.id);
    const history = await request('/api/v1/runs', { cookie: signedIn.cookie });
    assert.ok(history.data.runs.some(run => run.id === saved.data.data.runId));
  } finally {
    spawnSync('docker', ['rm', '-f', container, id + '-no-volume'], { timeout: 15000, stdio: 'ignore' });
    spawnSync('docker', ['volume', 'rm', volume], { timeout: 15000, stdio: 'ignore' });
  }
});
