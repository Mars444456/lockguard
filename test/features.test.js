const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RuleEngine,
  AutoSplitter,
  ContextAnalyzer,
  CascadeGraph,
  PostDeployWatchdog,
  ShadowReplaySimulator,
  PgParser
} = require('../src/core');

test('AutoSplitter - splits dangerous ADD COLUMN with volatile DEFAULT into 4 safe phases', () => {
  const sql = "ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT now() NOT NULL;";
  const engine = new RuleEngine();
  const analysis = engine.analyze(sql);

  const plan = AutoSplitter.generatePlan(analysis, 'sql');
  assert.equal(plan.isSafe, false);
  assert.equal(plan.totalPhases, 4);

  assert.ok(plan.phases[0].sql.includes('ALTER TABLE orders ADD COLUMN created_at TIMESTAMP;'));
  assert.ok(plan.phases[1].sql.includes('UPDATE orders SET created_at = now() WHERE created_at IS NULL;'));
  assert.ok(plan.phases[2].sql.includes('CHECK (created_at IS NOT NULL) NOT VALID'));
  assert.ok(plan.phases[3].sql.includes('VALIDATE CONSTRAINT chk_orders_created_at_not_null'));
});

test('ContextAnalyzer - enriches violations with table rows, size, and estimated downtime', () => {
  const sql = "ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT now() NOT NULL;";
  const engine = new RuleEngine();
  const analysis = engine.analyze(sql);

  const enriched = ContextAnalyzer.enrich(analysis, {
    tables: {
      orders: { rowCount: 14200000, sizeMb: 8400 }
    }
  });

  assert.equal(enriched.hasLiveContext, true);
  assert.ok(enriched.maxEstimatedDowntimeSec > 30);
  assert.ok(enriched.violations[0].contextualMessage.includes('14.2 млн строк'));
  assert.ok(enriched.violations[0].contextualMessage.includes('8.2 GB'));
});

test('CascadeGraph - detects unindexed foreign key hazards on parent table modification', () => {
  const sql = `
    ALTER TABLE invoices ADD CONSTRAINT fk_invoices_org FOREIGN KEY (org_id) REFERENCES organizations(id);
  `;
  const ast = PgParser.parse(sql);
  const graph = new CascadeGraph();
  graph.buildFromAst(ast);

  const risks = graph.findCascadeRisks('organizations');
  assert.equal(risks.length, 1);
  assert.equal(risks[0].childTable, 'invoices');
  assert.ok(risks[0].warning.includes('invoices.org_id'));
  assert.ok(risks[0].safeFix.includes('CREATE INDEX CONCURRENTLY idx_invoices_org_id'));
});

test('PostDeployWatchdog - identifies broken invalid indexes from failed concurrent runs', () => {
  const telemetry = [
    {
      index_name: 'idx_transactions_broken',
      table_name: 'transactions',
      is_valid: false,
      index_size: '5.1 GB'
    }
  ];

  const report = PostDeployWatchdog.evaluate(telemetry);
  assert.equal(report.healthy, false);
  assert.equal(report.totalInvalidCount, 1);
  assert.ok(report.invalidIndexes[0].safeFix.includes('REINDEX INDEX CONCURRENTLY'));
});

test('ShadowReplaySimulator - measures simulated lock latency and blocked requests', () => {
  const sql = "CREATE INDEX idx_orders_email ON orders (email);";
  const engine = new RuleEngine();
  const analysis = engine.analyze(sql);

  const sim = ShadowReplaySimulator.simulate(analysis, { simulatedRows: 50000, concurrentRps: 200 });
  assert.ok(sim.totalLockWaitContentionMs > 0);
  assert.ok(sim.totalBlockedQueriesEstimated > 0);
  assert.equal(sim.tableSimulations[0].table, 'orders');
});
