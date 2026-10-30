const {
  RuleEngine,
  GitHubPrFormatter,
  AutoSplitter,
  ContextAnalyzer,
  PostDeployWatchdog,
  ShadowReplaySimulator
} = require('../core');
const db = require('./db-mock');
const BillingService = require('./billing-service');
const requireAdmin = require('./admin-auth');
const GitHubService = require('./github-service');
const RobokassaProvider = require('./robokassa-provider');

const ruleEngine = new RuleEngine();

function registerRoutes(router) {
  const publicPaths = new Set(['/api/v1/analyze', '/api/v1/rules', '/api/v1/verify-key', '/api/v1/split', '/api/v1/simulate', '/api/v1/watchdog']);
  const targetRouter = router;
  router = Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (path, handler) => {
    targetRouter[method](path, async (req, res) => {
      await RuleEngine.initialize();
      const providerWebhook = path === '/api/v1/billing/robokassa/result' || path === '/billing/success' || path === '/billing/fail' ||
        (path === '/api/v1/github/webhook' && req.headers?.['x-github-event']);
      if (!publicPaths.has(path) && !providerWebhook && !requireAdmin(req, res)) return;
      try { return await handler(req, res); }
      catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        if (error instanceof SyntaxError) return res.status(422).json({ error: error.message });
        throw error;
      }
    });
  }]));
  // 1. Analyze Migration SQL
  router.post('/api/v1/analyze', async (req, res) => {
    try {
      const { sql, filename, apiKey, recordRun = false, repo, prNumber, branch, withContext = false } = req.body || {};

      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "sql" parameter.' });
      }

      // Check API key if provided
      let verifiedKey = null;
      if (apiKey) {
        verifiedKey = db.verifyApiKey(apiKey);
        if (!verifiedKey) {
          return res.status(401).json({ error: 'Invalid or revoked LockGuard API Key.' });
        }
      }

      let result = ruleEngine.analyze(sql, {
        filename: filename || 'custom_migration.sql'
      });

      if (withContext) {
        result = ContextAnalyzer.enrich(result, { demoMode: true });
      }

      // Optionally record into audit run history
      if (recordRun || repo) {
        if (!requireAdmin(req, res)) return;
        db.addRun({
          repo: repo || 'acme/main-app',
          prNumber: prNumber || Math.floor(Math.random() * 500) + 100,
          branch: branch || 'feat/db-migration',
          commit: Math.random().toString(16).substring(2, 9),
          author: 'dev-user',
          status: result.passed ? 'PASSED' : 'BLOCKED',
          highestLockLevel: result.highestLockLevel,
          violationsCount: result.violationsCount,
          criticalCount: result.criticalCount,
          highCount: result.highCount,
          summary: result.passed 
            ? 'All lock checks passed safely.' 
            : `Blocked: ${result.criticalCount} critical, ${result.highCount} high lock violations.`
        });
      }

      const markdownReport = GitHubPrFormatter.format([result]);

      return res.status(200).json({
        success: true,
        data: {
          ...result,
          markdownReport
        }
      });
    } catch (err) {
      console.error('API /analyze error:', err);
      return res.status(err instanceof SyntaxError ? 422 : 500).json({ error: err.message });
    }
  });

  // 2. Get Rules Catalog
  router.get('/api/v1/rules', async (req, res) => {
    const rules = ruleEngine.getRules();
    return res.status(200).json({ success: true, count: rules.length, rules });
  });

  // 3. Verify API Key
  router.post('/api/v1/verify-key', async (req, res) => {
    const { apiKey } = req.body || {};
    const valid = db.verifyApiKey(apiKey);
    if (!valid) {
      return res.status(401).json({ valid: false, message: 'Invalid or expired API Key.' });
    }
    return res.status(200).json({
      valid: true,
      organization: db.getOrganization(),
      keyDetails: {
        id: valid.id,
        name: valid.name,
        plan: db.getOrganization().plan
      }
    });
  });

  // 4. Organization & Quotas
  router.get('/api/v1/organization', async (req, res) => {
    return res.status(200).json({
      success: true,
      organization: db.getOrganization()
    });
  });

  router.post('/api/v1/organization', async (req, res) => {
    const { name, plan } = req.body || {};
    const patch = {};
    if (name) patch.name = name;
    if (plan) return res.status(400).json({ error: 'Plan activation requires verified payment.' });
    const updated = db.updateOrganization(patch);
    return res.status(200).json({ success: true, organization: updated });
  });

  // 4.1 B2B Invoice Generation for Legal Entities
  router.post('/api/v1/billing/b2b-invoice', async (req, res) => {
    const { companyName, inn, plan = 'team', email } = req.body || {};
    const invoice = BillingService.generateB2BInvoice({ companyName, inn, plan, email });
    return res.status(200).json(invoice);
  });

  router.get('/api/v1/billing/invoice', async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const company = url.searchParams.get('company') || '';
    const inn = url.searchParams.get('inn') || '';
    const plan = url.searchParams.get('plan') || 'team';
    const invoice = BillingService.generateB2BInvoice({ companyName: company, inn, plan });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(invoice.html);
  });

  // 5. API Keys Management
  router.get('/api/v1/keys', async (req, res) => {
    return res.status(200).json({
      success: true,
      keys: db.getApiKeys()
    });
  });

  router.post('/api/v1/keys', async (req, res) => {
    const { name } = req.body || {};
    const newKey = db.createApiKey(name || 'New Production Key');
    return res.status(201).json({
      success: true,
      key: newKey
    });
  });

  router.delete('/api/v1/keys/:id', async (req, res) => {
    const id = req.params.id;
    const success = db.revokeApiKey(id);
    if (!success) {
      return res.status(404).json({ error: 'Key not found.' });
    }
    return res.status(200).json({ success: true, message: 'Key revoked.' });
  });

  // 6. Audit Runs History
  router.get('/api/v1/runs', async (req, res) => {
    return res.status(200).json({
      success: true,
      runs: db.getRuns()
    });
  });

  // 7. Robokassa payment forms and authenticated server notification.
  router.post('/api/v1/billing/checkout', async (req, res) => {
    try {
      const session = new RobokassaProvider().checkout(req.body || {});
      return res.status(200).json(session);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message });
    }
  });

  router.post('/api/v1/billing/robokassa/result', async (req, res) => {
    const acknowledgement = new RobokassaProvider().process(req.body || {});
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(acknowledgement);
  });

  router.get('/api/v1/billing/orders', async (req, res) => res.json({ success: true, orders: db.getPaymentOrders() }));

  for (const [route, status] of [['/billing/success', 'return'], ['/billing/fail', 'cancelled']]) {
    router.get(route, async (req, res) => {
      res.writeHead(303, { Location: `/?payment=${status}#tab-billing` });
      res.end();
    });
  }

  router.post('/api/v1/billing/portal', async (req, res) => {
    return res.status(410).json({ error: 'Автоподписки отключены. Доступ Pro продлевается разовой оплатой за 30 дней.' });
  });

  // 8. GitHub PR Webhook (Real & Simulated)
  router.post('/api/v1/github/webhook', async (req, res) => {
    const isRealGithub = !!(req.headers && req.headers['x-github-event']);
    if (isRealGithub) {
      const service = new GitHubService();
      service.verify(req.rawBody, req.headers['x-hub-signature-256']);
      return res.json(await service.audit(req.body, req.headers['x-github-event']));
    }
    const prData = req.body && req.body.pull_request ? req.body.pull_request : null;
    const repoData = req.body && req.body.repository ? req.body.repository : null;

    const repo = repoData ? repoData.full_name : (req.body && req.body.repo ? req.body.repo : 'acme/ecommerce-api');
    const prNumber = prData ? prData.number : (req.body && req.body.prNumber ? Number(req.body.prNumber) : 422);
    const branch = prData && prData.head ? prData.head.ref : (req.body && req.body.branch ? req.body.branch : 'feat/db-upgrade');
    const commit = prData && prData.head && prData.head.sha ? prData.head.sha.substring(0, 7) : (req.body && req.body.commit ? req.body.commit : 'e92a10c');
    const author = req.body && req.body.sender ? req.body.sender.login : (req.body && req.body.author ? req.body.author : 'developer');

    const sampleSql = (req.body && req.body.sql) || `
      BEGIN;
      CREATE INDEX idx_products_sku ON products (sku);
      ALTER TABLE users ADD COLUMN phone VARCHAR(20) DEFAULT 'unverified' NOT NULL;
      COMMIT;
    `;
    const analysis = ruleEngine.analyze(sampleSql, { filename: 'migration_pr_' + prNumber + '.sql' });
    const markdown = GitHubPrFormatter.format([analysis]);

    const runRecord = db.addRun({
      repo,
      prNumber: Number(prNumber),
      branch,
      commit,
      author,
      status: analysis.passed ? 'PASSED' : 'BLOCKED',
      highestLockLevel: analysis.highestLockLevel,
      violationsCount: analysis.violationsCount,
      criticalCount: analysis.criticalCount,
      highCount: analysis.highCount,
      summary: analysis.passed ? 'Zero downtime migration' : 'Blocked: Dangerous locks detected.'
    });

    return res.status(200).json({
      success: true,
      action: analysis.passed ? 'approved' : 'blocked',
      prNumber,
      runId: runRecord.id,
      isRealGithub,
      markdownComment: markdown
    });
  });

  // 9. Auto-Splitter: Multi-phase generation
  router.post('/api/v1/split', async (req, res) => {
    const { sql, orm = 'sql' } = req.body || {};
    if (typeof sql !== 'string' || !sql.trim()) return res.status(400).json({ error: 'Missing or invalid sql' });
    const analysis = ruleEngine.analyze(sql);
    const plan = AutoSplitter.generatePlan(analysis, orm);
    return res.status(200).json({ success: true, plan });
  });

  // 10. Post-Deploy Watchdog: Invalid Index Inspection
  router.get('/api/v1/watchdog', async (req, res) => {
    const mockTelemetry = [
      {
        index_name: 'idx_orders_user_id_failed',
        table_name: 'orders',
        is_valid: false,
        index_size: '3.4 GB'
      }
    ];
    const report = PostDeployWatchdog.evaluate(mockTelemetry);
    return res.status(200).json({ success: true, report });
  });

  // 11. Shadow Replay Simulator
  router.post('/api/v1/simulate', async (req, res) => {
    const { sql, simulatedRows = 50000, concurrentRps = 250 } = req.body || {};
    if (typeof sql !== 'string' || !sql.trim()) return res.status(400).json({ error: 'Missing or invalid sql' });
    if (![simulatedRows, concurrentRps].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
      return res.status(400).json({ error: 'Simulation parameters must be non-negative finite numbers' });
    }
    const analysis = ruleEngine.analyze(sql);
    const sim = ShadowReplaySimulator.simulate(analysis, { simulatedRows, concurrentRps });
    return res.status(200).json({ success: true, simulation: sim });
  });
}

module.exports = registerRoutes;
