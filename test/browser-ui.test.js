require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { RuleEngine, AutoSplitter, ShadowReplaySimulator } = require('../src/core');
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8');

function page() {
  const { document } = parseHTML(html);
  const engine = new RuleEngine();
  let report;
  const window = {
    location: { hash: '' },
    LockGuard: {
      ready: RuleEngine.initialize(),
      analyze: (...args) => engine.analyze(...args),
      simulate: (...args) => ShadowReplaySimulator.simulate(...args),
      generatePlan: (...args) => AutoSplitter.generatePlan(...args)
    },
    open: () => ({ document: { open() {}, write(text) { report = text; }, close() {} } })
  };
  const scope = { window, document, console, setTimeout, clearTimeout, URL, Blob,
    navigator: { clipboard: { writeText: async () => {} } }, alert: text => { throw new Error(text); } };
  vm.runInNewContext(script + '\nthis.Playground = LockGuardWebPlayground;', scope);
  const app = new scope.Playground();
  app.splitterPanel.scrollIntoView = () => {};
  return { app, document, report: () => report };
}

test('Published HTML and app render a complete unsafe migration report', async () => {
  const { app, document } = page();
  const result = await app.runAnalysis();
  assert.ok(result, document.getElementById('empty-state').textContent);
  assert.equal(result.passed, false);
  assert.ok(document.getElementById('verdict-badge').classList.contains('failed'));
  assert.ok(document.getElementById('verdict-badge').textContent.includes('Найдены риски'));
  assert.ok(Number(document.getElementById('res-violations-count').textContent) >= 6);
  assert.ok(document.querySelectorAll('.violation-card').length >= 6);
  assert.equal(document.getElementById('analysis-details').classList.contains('hidden'), false);
});

test('Invalid SQL clears old results and exports await the current input', async () => {
  const { app, document, report } = page();
  await app.runAnalysis();
  app.sqlInput.value = 'ALTER TABLE';
  assert.equal(await app.runAnalysis(), null);
  assert.equal(app.lastAnalysis, null);
  assert.equal(document.getElementById('verdict-badge').textContent, 'Ошибка анализа');
  assert.equal(document.getElementById('analysis-details').classList.contains('hidden'), true);
  app.sqlInput.value = 'CREATE INDEX new_idx ON new_table(id);';
  await app.runSplitter();
  assert.ok(app.splitterPhases.textContent.includes('new_table'));
  assert.ok(!app.splitterPhases.textContent.includes('transactions'));
  app.sqlInput.value = 'CREATE INDEX last_idx ON last_table(id);';
  await app.exportPdfReport();
  assert.ok(report().includes('last_table'));
  assert.ok(!report().includes('new_table'));
  assert.ok(!report().includes('undefined'));
});

test('Splitter and printable report display SQL as text instead of HTML', async () => {
  const { app, document, report } = page();
  app.sqlInput.value = `ALTER TABLE accounts ADD COLUMN detail text DEFAULT ('</pre><img src=x onerror=alert(1)>' || gen_random_uuid());`;
  await app.runSplitter();
  assert.ok(app.splitterPhases.textContent.includes('<img'));
  assert.equal(app.splitterPhases.querySelector('img'), null);
  await app.exportPdfReport();
  const printed = parseHTML(report()).document;
  assert.equal(printed.querySelector('img'), null);
  assert.ok(printed.body.textContent.includes('<img'));
  assert.equal(document.querySelector('#violations-list img'), null);
});

test('Incomplete analysis never produces runnable migration drafts', async () => {
  const { app } = page();
  app.sqlInput.value = 'DO $$ BEGIN NULL; END $$;';
  await app.runSplitter();
  assert.equal(app.lastAnalysis.analysisComplete, false);
  assert.ok(app.splitterPhases.textContent.includes('анализ неполный'));
  assert.equal(app.splitterPhases.querySelector('pre'), null);
});

test('The initial demo waits for an explicit check and keeps simulated metrics separate', async () => {
  const { app, document } = page();
  assert.equal(app.lastAnalysis, null);
  assert.equal(document.getElementById('analysis-details').classList.contains('hidden'), true);
  assert.equal(document.querySelectorAll('.primary-metrics .metric-tile').length, 2);
  assert.equal(document.getElementById('simulation-estimates').hasAttribute('open'), false);
  await app.runAnalysis();
  assert.ok(document.getElementById('res-affected-tables').textContent.includes('accounts'));
  assert.equal(document.getElementById('btn-analyze').disabled, false);
});

test('DML displays its actual inferred table lock and does not promise zero downtime', async () => {
  const { app, document, report } = page();
  app.sqlInput.value = 'UPDATE orders SET id=1;';
  await app.runAnalysis();
  assert.equal(document.getElementById('res-max-lock').textContent, 'ROW EXCLUSIVE');
  assert.equal(document.getElementById('simulation-estimates').hidden, true);
  assert.equal(document.getElementById('res-downtime').textContent, '—');
  await app.exportPdfReport();
  const printed = parseHTML(report()).document;
  assert.ok(printed.body.textContent.includes('ROW EXCLUSIVE'));
  assert.ok(printed.body.textContent.includes('Не оценено'));
  assert.ok(!printed.body.textContent.includes('Расчетный простой базы: 0.0'));
});

test('Summary conflict badges cover SHARE ROW EXCLUSIVE and EXCLUSIVE table locks', () => {
  const { app, document } = page();
  for (const level of ['SHARE ROW EXCLUSIVE', 'EXCLUSIVE']) {
    app.renderLockMatrix(level);
    assert.equal(document.getElementById('matrix-select').classList.contains('allowed'), true);
    assert.equal(document.getElementById('matrix-insert').classList.contains('blocked'), true);
  }
});
