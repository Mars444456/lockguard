const { RuleEngine, GitHubPrFormatter } = require('../core');
const db = require('./db-mock');
const StripeService = require('./stripe-service');

const ruleEngine = new RuleEngine();

function registerRoutes(router) {
  // 1. Analyze Migration SQL
  router.post('/api/v1/analyze', async (req, res) => {
    try {
      const { sql, filename, apiKey, recordRun = false, repo, prNumber, branch } = req.body || {};

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

      const result = ruleEngine.analyze(sql, {
        filename: filename || 'custom_migration.sql'
      });

      // Optionally record into audit run history
      if (recordRun || repo) {
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
      return res.status(500).json({ error: 'Internal analysis error: ' + err.message });
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

  // 7. Stripe Billing Checkout & Customer Portal
  router.post('/api/v1/billing/checkout', async (req, res) => {
    try {
      const { plan, successUrl, cancelUrl } = req.body || {};
      const session = await StripeService.createCheckoutSession({
        plan: plan || 'team',
        successUrl,
        cancelUrl
      });
      return res.status(200).json(session);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  router.post('/api/v1/billing/portal', async (req, res) => {
    const portal = await StripeService.createCustomerPortalSession();
    return res.status(200).json(portal);
  });

  // 8. GitHub PR Webhook simulation
  router.post('/api/v1/github/webhook', async (req, res) => {
    const { prNumber = 422, branch = 'feat/db-upgrade', sql } = req.body || {};
    const sampleSql = sql || `
      BEGIN;
      CREATE INDEX idx_products_sku ON products (sku);
      ALTER TABLE users ADD COLUMN phone VARCHAR(20) DEFAULT 'unverified' NOT NULL;
      COMMIT;
    `;
    const analysis = ruleEngine.analyze(sampleSql, { filename: 'migration_pr_' + prNumber + '.sql' });
    const markdown = GitHubPrFormatter.format([analysis]);

    db.addRun({
      repo: 'acme/ecommerce-api',
      prNumber: Number(prNumber),
      branch,
      commit: 'e92a10c',
      author: 'pr-developer',
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
      markdownComment: markdown
    });
  });
}

module.exports = registerRoutes;
