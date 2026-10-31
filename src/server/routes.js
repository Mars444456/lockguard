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
const AuthService = require('./auth-service');
const SchemaCatalog = require('../core/schema-catalog');
const { features, requirePro } = require('./pro-features');
const RunComparison = require('./run-comparison');

const ruleEngine = new RuleEngine();

function registerRoutes(router) {
  const auth = new AuthService(db);
  const authPaths = new Set(['/api/v1/auth/session', '/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/password']);
  const publicPaths = new Set(['/api/v1/analyze', '/api/v1/rules', '/api/v1/verify-key', '/api/v1/split', '/api/v1/simulate', '/api/v1/watchdog']);
  const targetRouter = router;
  router = Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (path, handler) => {
    targetRouter[method](path, async (req, res) => {
      try {
        res.setHeader?.('Cache-Control', 'no-store');
        await RuleEngine.initialize();
        req.auth = requireAdmin.isAdmin(req) ? null : auth.authenticate(req);
        req.store = req.auth ? db.forOrganization(req.auth.organizationId) : db;
        const providerWebhook = path === '/api/v1/billing/robokassa/result' || path === '/billing/success' || path === '/billing/fail' ||
          (path === '/api/v1/github/webhook' && req.headers?.['x-github-event']);
        if (req.auth && !providerWebhook) auth.validateMutation(req);
        if (!publicPaths.has(path) && !authPaths.has(path) && !providerWebhook && !req.auth) {
          if (!process.env.LOCKGUARD_ADMIN_TOKEN) return res.status(401).json({ error: 'Войдите в аккаунт для доступа к своей организации.' });
          if (!requireAdmin(req, res)) return;
        }
        // Payment onboarding stays with the operator while the merchant is being activated.
        if (req.auth && ['/api/v1/billing/checkout', '/api/v1/billing/b2b-invoice', '/api/v1/billing/invoice'].includes(path)) {
          return res.status(403).json({ error: 'Онлайн-оплата ещё подключается. Согласуйте заказ с исполнителем по контактам на сайте.' });
        }
        return await handler(req, res);
      }
      catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        if (error instanceof SyntaxError) return res.status(422).json({ error: error.message });
        throw error;
      }
    });
  }]));
  auth.registerRoutes(router);
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
        if (req.auth && req.auth.organizationId !== verifiedKey.organizationId) return res.status(403).json({ error: 'API key belongs to another organization.' });
      }
      const store = verifiedKey ? db.forOrganization(verifiedKey.organizationId) : req.store;
      let profile = null;
      if (req.body.schemaId !== undefined || req.body.schema !== undefined) {
        if (!verifiedKey && !req.auth && !requireAdmin.isAdmin(req)) return res.status(401).json({ error:'Войдите для анализа с сохранённой схемой.' });
        requirePro(store);
        if (req.body.schemaId !== undefined) {
          if (typeof req.body.schemaId !== 'string') return res.status(400).json({ error:'Неверный идентификатор схемы.' });
          profile = store.getSchema(req.body.schemaId);
          if (!profile) return res.status(404).json({ error:'Схема не найдена.' });
        } else return res.status(400).json({ error:'Передайте schemaId сохранённой схемы.' });
      }

      let result = ruleEngine.analyze(sql, {
        filename: filename || 'custom_migration.sql',
        schema: profile?.schema
      });

      if (withContext && !profile) {
        result = ContextAnalyzer.enrich(result, { demoMode: true });
      }

      const markdownReport = GitHubPrFormatter.format([result]);
      let run = null;
      // Save the real origin and report; a manual check must not invent a GitHub PR.
      if (recordRun || repo) {
        if (!verifiedKey && !req.auth && !requireAdmin(req, res)) return;
        run = store.addRun({
          filename: result.filename, findingsVersion: 1, findings: RunComparison.findings(result), analysisComplete: result.analysisComplete,
          schemaId: profile?.id || null, schemaRevision: profile?.revision || null,
          source: repo ? 'api' : 'dashboard',
          repo: repo || '',
          prNumber: prNumber || null,
          branch: branch || '',
          commit: '',
          author: req.auth?.email || 'api',
          markdownReport,
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
      if (verifiedKey || req.auth || requireAdmin.isAdmin(req)) store.recordCheck();

      return res.status(200).json({
        success: true,
        data: {
          ...result,
          runId: run?.id || null,
          schemaProfile: profile ? { id:profile.id, name:profile.name, revision:profile.revision } : null,
          markdownReport
        }
      });
    } catch (err) {
      if (!err.statusCode && !(err instanceof SyntaxError)) console.error('API /analyze error:', err);
      return res.status(err.statusCode || (err instanceof SyntaxError ? 422 : 500)).json({ error: err.message });
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
      organization: db.forOrganization(valid.organizationId).getOrganization(),
      keyDetails: {
        id: valid.id,
        name: valid.name,
        plan: db.forOrganization(valid.organizationId).getOrganization().plan
      }
    });
  });

  // 4. Organization & Quotas
  router.get('/api/v1/organization', async (req, res) => {
    return res.status(200).json({
      success: true,
      organization: { ...req.store.getOrganization(), features: features(req.store.getOrganization()) }
    });
  });

  router.post('/api/v1/organization', async (req, res) => {
    const { name, plan } = req.body || {};
    const patch = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) return res.status(400).json({ error: 'Organization name must contain 1–100 characters.' });
      patch.name = name.trim();
    }
    if (plan) return res.status(400).json({ error: 'Plan activation requires verified payment.' });
    const updated = req.store.updateOrganization(patch);
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
      keys: req.store.getApiKeys()
    });
  });

  router.post('/api/v1/keys', async (req, res) => {
    const { name } = req.body || {};
    const newKey = req.store.createApiKey(name || 'New Production Key');
    return res.status(201).json({
      success: true,
      key: newKey
    });
  });

  router.delete('/api/v1/keys/:id', async (req, res) => {
    const id = req.params.id;
    const success = req.store.revokeApiKey(id);
    if (!success) {
      return res.status(404).json({ error: 'Key not found.' });
    }
    return res.status(200).json({ success: true, message: 'Key revoked.' });
  });

  // 6. Audit Runs History
  router.get('/api/v1/runs/compare', async (req,res) => {
    requirePro(req.store);
    const before=req.store.getRun(req.query.before || ''), after=req.store.getRun(req.query.after || '');
    if(!before || !after) return res.status(404).json({error:'Проверка не найдена.'});
    if(before.id===after.id) return res.status(400).json({error:'Выберите две разные проверки.'});
    res.json({success:true,comparison:RunComparison.compare(before,after)});
  });
  router.get('/api/v1/schemas', async (req,res) => res.json({success:true,schemas:req.store.getSchemas(),features:features(req.store.getOrganization())}));
  router.post('/api/v1/schemas', async (req,res) => {
    requirePro(req.store);
    const catalog = req.body.sql !== undefined ? SchemaCatalog.fromSQL(req.body.sql,{pgVersion:req.body.pgVersion || 17,defaultSchema:req.body.defaultSchema || 'public'}) : SchemaCatalog.from(req.body.schema);
    const { schema, ...meta }=req.store.saveSchema({name:req.body.name,schema:catalog.toJSON(),summary:catalog.summary()});
    res.status(201).json({success:true,profile:meta});
  });
  router.get('/api/v1/schemas/:id', async (req,res) => {
    const profile=req.store.getSchema(req.params.id);
    if(!profile)return res.status(404).json({error:'Схема не найдена.'});
    res.json({success:true,profile});
  });
  router.delete('/api/v1/schemas/:id', async (req,res) => {
    if(!req.store.deleteSchema(req.params.id))return res.status(404).json({error:'Схема не найдена.'});
    res.json({success:true});
  });
  router.get('/api/v1/runs', async (req, res) => {
    return res.status(200).json({
      success: true,
      runs: req.store.getRuns()
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

  router.get('/api/v1/billing/orders', async (req, res) => res.json({ success: true, orders: req.store.getPaymentOrders() }));

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

    const runRecord = req.store.addRun({
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
    let schema;
    if (req.body.schemaId !== undefined) {
      if(typeof req.body.schemaId!=='string')return res.status(400).json({error:'Неверный идентификатор схемы.'});
      if (!req.auth && !requireAdmin.isAdmin(req)) return res.status(401).json({error:'Войдите для использования сохранённой схемы.'});
      requirePro(req.store);
      const profile=req.store.getSchema(req.body.schemaId);
      if(!profile)return res.status(404).json({error:'Схема не найдена.'});
      schema=profile.schema;
    }
    const analysis = ruleEngine.analyze(sql,{schema});
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
