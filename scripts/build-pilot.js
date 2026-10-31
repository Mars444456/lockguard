const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { RuleEngine, SchemaCatalog } = require('../src/core');
const { findings, compare } = require('../src/server/run-comparison');

async function pilotExample(root = path.resolve(__dirname, '..')) {
  await RuleEngine.initialize();
  const read = name => fs.readFileSync(path.join(root, 'fixtures/team-pilot', name + '.sql'), 'utf8').replaceAll('\r\n', '\n');
  const schemaSql = read('schema'), beforeSql = read('before'), afterSql = read('after');
  const schema = SchemaCatalog.fromSQL(schemaSql).toJSON();
  const revision = createHash('sha256').update(JSON.stringify(schema)).digest('hex');
  const engine = new RuleEngine();
  const withoutSchema = engine.analyze(beforeSql, { filename: 'migration.sql' });
  const before = engine.analyze(beforeSql, { filename: 'migration.sql', schema });
  const after = engine.analyze(afterSql, { filename: 'migration.sql', schema });
  const compact = result => ({ analysisComplete: result.analysisComplete, passed: result.passed,
    findings: result.violations.map(v => ({ ruleId: v.ruleId, severity: v.severity, table: v.table, message: v.message, line: v.line })) });
  const run = (id, result) => ({ id, filename: 'migration.sql', schemaRevision: revision,
    findingsVersion: 1, analysisComplete: result.analysisComplete, findings: findings(result) });
  const delta = compare(run('before', before), run('after', after));
  return { version: require('../package.json').version, synthetic: true, schemaSql, beforeSql, afterSql,
    withoutSchema: compact(withoutSchema), before: compact(before), after: compact(after),
    comparison: { resolved: delta.resolved.map(f => f.ruleId), introduced: delta.introduced.map(f => f.ruleId),
      persisting: delta.persisting.map(f => f.ruleId), contextChanged: delta.contextChanged } };
}

async function buildPilot(root = path.resolve(__dirname, '..')) {
  require('./check-privacy').assertPublishable(root);
  const example = await pilotExample(root);
  const data = 'window.LockGuardPilotExample = ' + JSON.stringify(example, null, 2).replaceAll('<', '\\u003c') + ';\n';
  const template = fs.readFileSync(path.join(root, 'scripts/templates/start.html'), 'utf8').replaceAll('\r\n', '\n');
  const assets = { 'pilot-example.js': data };
  for (const name of ['pilot-guide.css', 'pilot-guide.js']) assets[name] = fs.readFileSync(path.join(root, 'src/ui', name), 'utf8').replaceAll('\r\n', '\n');
  const html = template.replace(/(href|src)="(pilot-guide\.css|pilot-guide\.js|pilot-example\.js)"/g, (_, attr, name) =>
    `${attr}="${name}?v=${createHash('sha256').update(assets[name]).digest('hex').slice(0, 12)}"`);
  for (const directory of ['src/ui', 'docs']) {
    fs.writeFileSync(path.join(root, directory, 'start.html'), html);
    for (const [name, contents] of Object.entries(assets)) fs.writeFileSync(path.join(root, directory, name), contents);
  }
  require('./check-privacy').assertPublishable(root);
}

if (require.main === module) buildPilot().then(() => console.log('Pilot example built: 2 findings without schema, 1 with schema, 0 after revision.')).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { pilotExample, buildPilot };
