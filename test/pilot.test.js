require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { pilotExample } = require('../scripts/build-pilot');
const root = path.resolve(__dirname, '..');

test('Public pilot evidence matches the current analyzer and compares changes on the same schema', async () => {
  const example = await pilotExample();
  assert.deepEqual(example.withoutSchema.findings.map(f => f.ruleId), ['LG-002', 'LG-011']);
  assert.deepEqual(example.before.findings.map(f => f.ruleId), ['LG-002']);
  assert.equal(example.after.analysisComplete, true);
  assert.deepEqual(example.after.findings, []);
  assert.deepEqual(example.comparison, { resolved: ['LG-002'], introduced: [], persisting: [], contextChanged: false });
  const scope = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/pilot-example.js'), 'utf8'), scope);
  assert.equal(JSON.stringify(scope.window.LockGuardPilotExample), JSON.stringify(example), 'Rebuild stale public evidence with npm run demo:pilot');
});

test('Pilot page switches to the revised SQL, opens exactly that SQL and handles unavailable clipboard', async () => {
  const example = await pilotExample();
  const { document, Event } = parseHTML(fs.readFileSync(path.join(root, 'docs/start.html'), 'utf8'));
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/ui/pilot-guide.js'), 'utf8'), {
    window: { LockGuardPilotExample: example }, document,
    navigator: { clipboard: { writeText: async () => { throw new Error('Clipboard denied'); } } }
  });
  assert.equal(document.querySelectorAll('#example-findings li').length, 2);
  document.querySelector('[data-case="after"]').dispatchEvent(new Event('click'));
  assert.equal(document.querySelectorAll('[aria-pressed="true"]').length, 1);
  assert.equal(document.getElementById('example-sql').textContent, example.afterSql);
  assert.equal(decodeURIComponent(document.getElementById('open-example').getAttribute('href').split('#sql=')[1]), example.afterSql);
  assert.ok(document.querySelector('#example-findings .clear'));
  document.getElementById('copy-sql').dispatchEvent(new Event('click'));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(document.getElementById('copy-status').textContent.includes('Выделите SQL'));
});
