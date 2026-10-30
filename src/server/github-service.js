const { createHmac, timingSafeEqual } = require('node:crypto');
const { RuleEngine, GitHubPrFormatter } = require('../core');
function fail(message, status = 400) { const error = new Error(message); error.statusCode = status; throw error; }
class GitHubService {
  constructor({ secret = process.env.GITHUB_WEBHOOK_SECRET, token = process.env.GITHUB_TOKEN,
    repositories = process.env.GITHUB_REPOSITORIES || '', fetchImpl = fetch } = {}) {
    this.secret = secret; this.token = token; this.repositories = repositories.split(',').map(s => s.trim()).filter(Boolean);
    this.fetch = fetchImpl;
  }
  verify(body, signature) {
    if (!this.secret) fail('GitHub webhook is not configured', 503);
    const expected = Buffer.from('sha256=' + createHmac('sha256', this.secret).update(body).digest('hex'));
    const actual = Buffer.from(signature || '');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) fail('Invalid GitHub signature', 401);
  }
  async api(endpoint, body) {
    if (!this.token) fail('GitHub token is not configured', 503);
    const response = await this.fetch(`https://api.github.com${endpoint}`, { redirect: 'error', method: body ? 'POST' : 'GET',
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'LockGuard' } });
    if (!response.ok) fail(`GitHub API request failed (${response.status})`, 502);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); fail('GitHub response exceeds audit limit', 413); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async audit(payload, event) {
    if (event === 'ping') return { success: true, message: 'GitHub webhook verified' };
    if (event !== 'pull_request' || !['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(payload.action)) return { success: true, ignored: true };
    const repo = payload.repository?.full_name;
    const number = payload.pull_request?.number;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !Number.isSafeInteger(number) || number <= 0) fail('Invalid pull request payload');
    if (!this.repositories.includes(repo)) fail('Repository is not configured for this server', 403);
    const base = `/repos/${repo}/pulls/${number}`;
    const current = await this.api(base);
    const sha = current.head?.sha;
    if (!/^[a-f0-9]{40}$/.test(sha || '') || sha !== payload.pull_request.head?.sha) fail('Stale pull request event', 409);
    const publish = process.env.GITHUB_PUBLISH_STATUS === 'true';
    if (publish) await this.api(`/repos/${repo}/statuses/${sha}`, { state: 'pending', context: 'lockguard', description: 'Auditing PostgreSQL migrations' });
    if (!Number.isInteger(current.changed_files) || current.changed_files > 300) fail('Pull request exceeds 300-file audit limit', 413);
    const files = [];
    for (let page = 1; files.length < current.changed_files; page++) {
      const batch = await this.api(`${base}/files?per_page=100&page=${page}`);
      if (!Array.isArray(batch) || !batch.length) fail('Incomplete pull request file list', 502);
      files.push(...batch);
      if (files.length > 300) fail('Pull request exceeds audit limit', 413);
    }
    if (files.length !== current.changed_files) fail('Pull request changed while files were being fetched', 409);
    await RuleEngine.initialize();
    const engine = new RuleEngine();
    const results = [];
    let totalBytes = 0;
    for (const file of files.filter(f => /\.sql$/i.test(f.filename) && f.status !== 'removed')) {
      if (!/^[a-f0-9]{40}$/.test(file.sha || '')) fail('Invalid SQL blob reference', 502);
      const blob = await this.api(`/repos/${repo}/git/blobs/${file.sha}`);
      if (blob.encoding !== 'base64' || !Number.isInteger(blob.size) || blob.size > 512 * 1024) fail('SQL blob exceeds audit limit', 413);
      const bytes = Buffer.from(blob.content, 'base64');
      totalBytes += bytes.length;
      if (bytes.length !== blob.size || totalBytes > 2 * 1024 * 1024) fail('SQL audit payload exceeds limit or is incomplete', 413);
      try { results.push(engine.analyze(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { filename: file.filename })); }
      catch (error) {
        if (publish) await this.api(`/repos/${repo}/statuses/${sha}`, { state: 'error', context: 'lockguard', description: 'SQL analysis failed; inspect migration syntax' });
        throw error;
      }
    }
    if ((await this.api(base)).head?.sha !== sha) fail('Pull request changed during analysis', 409);
    if (publish) await this.api(`/repos/${repo}/statuses/${sha}`, { state: results.every(r => r.passed) ? 'success' : 'failure', context: 'lockguard', description: `${results.length} SQL migration(s) audited` });
    return { success: true, repo, prNumber: number, headSha: sha, checkedFiles: results.length, statusPublished: publish,
      passed: results.every(r => r.passed), results, markdownComment: GitHubPrFormatter.format(results) };
  }
}
module.exports = GitHubService;
