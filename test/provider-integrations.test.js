require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-providers-'));
process.env.LOCKGUARD_DB_FILE = path.join(directory, 'db.json');
const GitHubService = require('../src/server/github-service');


test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
const head = 'a'.repeat(40), blobSha = 'b'.repeat(40);
const payload = { action: 'opened', repository: { full_name: 'acme/app' }, pull_request: { number: 7, head: { sha: head } } };
test('GitHub checks the HMAC of original bytes, including Unicode', () => {
  const service = new GitHubService({ secret: 'secret' });
  const bytes = Buffer.from('{"text":"миграция"}');
  const signature = 'sha256=' + crypto.createHmac('sha256', 'secret').update(bytes).digest('hex');
  service.verify(bytes, signature);
  assert.throws(() => service.verify(Buffer.from('{}'), signature), /Invalid GitHub signature/);
});
test('GitHub audits actual blobs, ignores caller SQL and can publish a commit status', async t => {
  const old = process.env.GITHUB_PUBLISH_STATUS;
  process.env.GITHUB_PUBLISH_STATUS = 'true';
  t.after(() => { if (old === undefined) delete process.env.GITHUB_PUBLISH_STATUS; else process.env.GITHUB_PUBLISH_STATUS = old; });
  const requests = [];
  const sql = 'CREATE INDEX ix ON users(id);';
  const service = new GitHubService({ repositories: 'acme/app', token: 'test', fetchImpl: async (url, options) => {
    requests.push({ url, ...options });
    let data;
    if (url.includes('/statuses/')) data = { id: 1 };
    else if (url.includes('/files?')) data = [{ filename: 'migrations/01.sql', sha: blobSha, status: 'added' }];
    else if (url.includes('/git/blobs/')) data = { encoding: 'base64', size: Buffer.byteLength(sql), content: Buffer.from(sql).toString('base64') };
    else data = { head: { sha: head }, changed_files: 1 };
    return new Response(JSON.stringify(data));
  } });
  const result = await service.audit({ ...payload, sql: 'SELECT 1;' }, 'pull_request');
  assert.equal(result.passed, false);
  assert.equal(result.checkedFiles, 1);
  assert.ok(result.results[0].violations.some(v => v.ruleId === 'LG-002'));
  assert.equal(JSON.parse(requests.filter(r => r.method === 'POST').at(-1).body).state, 'failure');
  assert.ok(requests.every(r => r.url.startsWith('https://api.github.com/repos/acme/app/')));
});
test('GitHub rejects unauthorized repos, stale heads and truncated file lists', async () => {
  const unauthorized = new GitHubService({ repositories: 'different/repo' });
  await assert.rejects(unauthorized.audit(payload, 'pull_request'), /not configured/);
  const stale = new GitHubService({ repositories: 'acme/app', token: 'test', fetchImpl: async () => new Response(JSON.stringify({ head: { sha: blobSha }, changed_files: 1 })) });
  await assert.rejects(stale.audit(payload, 'pull_request'), /Stale/);
  const truncated = new GitHubService({ repositories: 'acme/app', token: 'test', fetchImpl: async url => new Response(JSON.stringify(url.includes('/files?') ? [] : { head: { sha: head }, changed_files: 1 })) });
  await assert.rejects(truncated.audit(payload, 'pull_request'), /Incomplete/);
});
