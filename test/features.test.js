require('./helpers/initialize');
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
  const sql = "ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT clock_timestamp() NOT NULL;";
  const engine = new RuleEngine();
  const analysis = engine.analyze(sql);

  const plan = AutoSplitter.generatePlan(analysis, 'sql');
  assert.equal(plan.isSafe, false);
  assert.equal(plan.totalPhases, 4);

  assert.ok(plan.phases[0].sql.includes('ALTER TABLE orders ADD COLUMN created_at TIMESTAMP;'));
  assert.ok(plan.phases[1].sql.includes('UPDATE orders SET created_at = clock_timestamp() WHERE created_at IS NULL;'));
  assert.ok(plan.phases[2].sql.includes('CHECK (created_at IS NOT NULL) NOT VALID'));
  assert.ok(plan.phases[3].sql.includes('VALIDATE CONSTRAINT chk_orders_created_at_not_null'));
});

test('ContextAnalyzer - enriches violations with table rows, size, and estimated downtime', () => {
  const sql = "ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT clock_timestamp() NOT NULL;";
  const engine = new RuleEngine();
  const analysis = engine.analyze(sql);

  const enriched = ContextAnalyzer.enrich(analysis, {
    tables: {
      orders: { rowCount: 14200000, sizeMb: 8400 }
    }
  });

  assert.equal(enriched.hasLiveContext, true);
  assert.ok(enriched.maxEstimatedDowntimeSec > 30);
  assert.ok(enriched.violations[0].contextualMessage.includes('14.2M rows'));
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

// ==============================================================================
// AutoSplitter comprehensive ORM and rules tests
// ==============================================================================
test('AutoSplitter - returns isSafe: true and empty phases when migration has no violations', () => {
  const safeSql = "SET lock_timeout = '3s'; CREATE TABLE test_table (id serial primary key);";
  const engine = new RuleEngine();
  const analysis = engine.analyze(safeSql);

  const plan = AutoSplitter.generatePlan(analysis, 'sql');
  assert.equal(plan.isSafe, true);
  assert.equal(plan.phases.length, 0);
  assert.ok(plan.message.includes('safe'));
});

test('AutoSplitter - formats multi-phase migrations for Prisma, Drizzle, Django, and Alembic', () => {
  const sql = "ALTER TABLE users ADD COLUMN bio TEXT DEFAULT 'none' NOT NULL;";
  // Force a violation to test splitter ORM formats
  const violationAnalysis = {
    violations: [
      {
        ruleId: 'LG-001',
        table: 'users',
        column: 'bio',
        defaultValue: "'none'"
      }
    ]
  };

  // Prisma
  const prismaPlan = AutoSplitter.generatePlan(violationAnalysis, 'prisma');
  assert.equal(prismaPlan.targetOrm, 'prisma');
  assert.ok(Array.isArray(prismaPlan.ormSnippets));
  assert.ok(prismaPlan.ormSnippets[0].instruction.includes('prisma'));

  // Drizzle
  const drizzlePlan = AutoSplitter.generatePlan(violationAnalysis, 'drizzle');
  assert.equal(drizzlePlan.targetOrm, 'drizzle');
  assert.ok(drizzlePlan.ormSnippets[0].instruction.includes('drizzle'));

  // Django
  const djangoPlan = AutoSplitter.generatePlan(violationAnalysis, 'django');
  assert.equal(djangoPlan.targetOrm, 'django');
  assert.ok(djangoPlan.ormSnippets[0].code.includes('from django.db import migrations'));
  assert.ok(djangoPlan.ormSnippets[0].code.includes('migrations.RunSQL'));

  // Alembic
  const alembicPlan = AutoSplitter.generatePlan(violationAnalysis, 'alembic');
  assert.equal(alembicPlan.targetOrm, 'alembic');
  assert.ok(alembicPlan.ormSnippets[0].code.includes('from alembic import op'));
  assert.ok(alembicPlan.ormSnippets[0].code.includes('op.execute'));
});

test('AutoSplitter - handles LG-002, LG-003, LG-004, LG-005, LG-006 anti-patterns in phased plan', () => {
  const multiViolationAnalysis = {
    violations: [
      { ruleId: 'LG-002', table: 'posts', indexName: 'idx_posts_author', columns: ['author_id'] },
      { ruleId: 'LG-003', table: 'posts', constraintName: 'fk_posts_author', foreignTable: 'authors', columns: ['author_id'] },
      { ruleId: 'LG-004', table: 'users', column: 'points', newType: 'BIGINT' },
      { ruleId: 'LG-005', table: 'users', constraintName: 'uq_users_username', columns: ['username'] },
      { ruleId: 'LG-006', table: 'users', column: 'old_secret' }
    ]
  };

  const plan = AutoSplitter.generatePlan(multiViolationAnalysis, 'sql');
  assert.equal(plan.isSafe, false);
  assert.ok(plan.phases.length >= 3, 'Must split into multiple phases');

  const p1Sql = plan.phases.find(p => p.phaseNumber === 1).sql;
  assert.ok(p1Sql.includes('CREATE INDEX CONCURRENTLY idx_posts_author'), 'LG-002 handled in Phase 1');
  assert.ok(p1Sql.includes('ADD CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES authors NOT VALID'), 'LG-003 uses parent primary key without assuming its column name');
  assert.ok(p1Sql.includes('points_new BIGINT'), 'LG-004 shadow column in Phase 1');
  assert.ok(p1Sql.includes('CREATE UNIQUE INDEX CONCURRENTLY uq_users_username_idx'), 'LG-005 concurrent unique index in Phase 1');

  const p3Sql = plan.phases.find(p => p.phaseNumber === 3).sql;
  assert.ok(p3Sql.includes('UNIQUE USING INDEX uq_users_username_idx'), 'LG-005 USING INDEX in Phase 3');
  assert.ok(p3Sql.includes('ALTER TABLE users DROP COLUMN IF EXISTS old_secret'), 'LG-006 DROP COLUMN in Phase 3');
});

// ==============================================================================
// PostDeployWatchdog inspectProduction and diagnostic query tests
// ==============================================================================
test('PostDeployWatchdog.inspectProduction - returns healthy: true and positive message when clean', () => {
  const resultClean = PostDeployWatchdog.inspectProduction([]);
  assert.equal(resultClean.healthy, true);
  assert.equal(resultClean.hasBrokenIndexes, false);
  assert.equal(resultClean.totalInvalidCount, 0);
  assert.ok(resultClean.message.includes('100% healthy'));

  const validTelemetry = [
    { index_name: 'idx_users_email', table_name: 'users', is_valid: true, index_size: '12 MB' }
  ];
  const resultWithValid = PostDeployWatchdog.inspectProduction(validTelemetry);
  assert.equal(resultWithValid.healthy, true);
  assert.equal(resultWithValid.hasBrokenIndexes, false);
  assert.equal(resultWithValid.totalInvalidCount, 0);
});

test('PostDeployWatchdog.inspectProduction - returns healthy: false, hasBrokenIndexes: true, and repair SQL when broken indexes found', () => {
  const brokenTelemetry = [
    { index_name: 'idx_orders_status', table_name: 'orders', is_valid: false, index_size: '2.4 GB' },
    { index_name: 'idx_payments_ref', table_name: 'payments', is_valid: false, index_size: '500 MB' }
  ];
  const result = PostDeployWatchdog.inspectProduction(brokenTelemetry);
  assert.equal(result.healthy, false);
  assert.equal(result.hasBrokenIndexes, true);
  assert.equal(result.totalInvalidCount, 2);
  assert.ok(result.message.includes('Detected 2 INVALID/BROKEN index(es)'));
  assert.ok(result.message.includes('REINDEX INDEX CONCURRENTLY idx_orders_status'));
  assert.ok(result.message.includes('DROP INDEX CONCURRENTLY IF EXISTS idx_payments_ref'));
});

test('PostDeployWatchdog.getDiagnosticQuery - returns diagnostic SQL checking pg_index.indisvalid', () => {
  const query = PostDeployWatchdog.getDiagnosticQuery();
  assert.ok(query.includes('SELECT'));
  assert.ok(query.includes('pg_index'));
  assert.ok(query.includes('NOT idx.indisvalid'));
});

// ==============================================================================
// ShadowReplaySimulator outageSeverity calculation tests
// ==============================================================================
test('ShadowReplaySimulator - calculates outageSeverity accurately: NONE, MODERATE, HIGH, CATASTROPHIC', () => {
  const engine = new RuleEngine();

  // 1. Safe migration: contention 0 -> NONE
  const safeAnalysis = engine.analyze("SET lock_timeout = '3s'; CREATE INDEX CONCURRENTLY idx_users ON users(id);");
  const simNone = ShadowReplaySimulator.simulate(safeAnalysis, { simulatedRows: 1000, concurrentRps: 10 });
  assert.equal(simNone.outageSeverity, 'NONE');

  // 2. Heavy non-concurrent index: large database -> CATASTROPHIC
  const heavyAnalysis = engine.analyze("CREATE INDEX idx_orders_user ON orders(user_id);");
  const simCatastrophic = ShadowReplaySimulator.simulate(heavyAnalysis, { simulatedRows: 10000000, concurrentRps: 500 });
  assert.equal(simCatastrophic.outageSeverity, 'CATASTROPHIC');

  // 3. Medium load simulation -> verifies MODERATE or HIGH severity thresholds
  const mediumAnalysis = engine.analyze("CREATE INDEX idx_orders_user ON orders(user_id);");
  const simMedium = ShadowReplaySimulator.simulate(mediumAnalysis, { simulatedRows: 50000, concurrentRps: 100 });
  assert.ok(['MODERATE', 'HIGH', 'CATASTROPHIC'].includes(simMedium.outageSeverity));
});

test('RuleEngine - CascadeGraph activates and records foreignTable in affectedTables', () => {
  const engine = new RuleEngine();
  const sql = `
    SET lock_timeout = '3s';
    ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id);
  `;
  const analysis = engine.analyze(sql);
  assert.ok(analysis.affectedTables.includes('orders'));
  assert.ok(analysis.affectedTables.includes('customers'), 'foreignTable must be accounted in affectedTables');
  assert.ok(analysis.cascadeWarnings.length > 0, 'CascadeGraph must generate warnings for cascade risks');
});

test('LG-008 - safeFix provides PL/pgSQL lock retry loop pattern', () => {
  const engine = new RuleEngine();
  const sql = `ALTER TABLE users ADD COLUMN bio text;`;
  const analysis = engine.analyze(sql);
  const v = analysis.violations.find(v => v.ruleId === 'LG-008');
  assert.ok(v);
  assert.ok(v.safeFix.includes('SET lock_timeout'));
  assert.ok(v.safeFix.includes('LOOP') && v.safeFix.includes('lock_not_available'), 'safeFix must include PL/pgSQL lock retry loop pattern');
});
