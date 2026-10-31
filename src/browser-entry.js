const RuleEngine = require('./core/rule-engine');
const AutoSplitter = require('./core/auto-splitter');
const simulator = require('./core/shadow-replay');
const context = require('./core/context-analyzer');
const SchemaCatalog = require('./core/schema-catalog');
const engine = new RuleEngine();
window.LockGuard = { RuleEngine, AutoSplitter, ready: RuleEngine.initialize(),
  analyze: (sql, options) => engine.analyze(sql, options),
  importSchema: (sql, options) => SchemaCatalog.fromSQL(sql, options).toJSON(),
  generatePlan: (analysis, orm) => AutoSplitter.generatePlan(analysis, orm),
  split: (sql, orm) => AutoSplitter.generatePlan(engine.analyze(sql), orm),
  simulate: (analysis, options) => simulator.simulate(analysis, options),
  enrich: (analysis, metadata) => context.enrich(analysis, metadata)
};
