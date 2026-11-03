require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const { RuleEngine, GitHubPrFormatter } = require('../src/core');
const engine = new RuleEngine();

test('A missing timeout retains the affected statement lock instead of inventing ACCESS EXCLUSIVE', () => {
  const cases = [
    ['CREATE INDEX ix ON demo(user_id);', 'SHARE'],
    ['CREATE INDEX CONCURRENTLY ix ON demo(user_id);', 'SHARE UPDATE EXCLUSIVE'],
    ['DROP INDEX CONCURRENTLY ix;', 'SHARE UPDATE EXCLUSIVE'],
    ['ALTER TABLE demo VALIDATE CONSTRAINT ck;', 'SHARE UPDATE EXCLUSIVE'],
    ['ALTER TABLE demo ADD CONSTRAINT fk FOREIGN KEY(user_id) REFERENCES users(id);', 'SHARE ROW EXCLUSIVE'],
    ['ALTER TABLE demo ADD COLUMN note text;', 'ACCESS EXCLUSIVE']
  ];
  for (const [sql, expected] of cases) {
    const result = engine.analyze(sql), finding = result.violations.find(v => v.ruleId === 'LG-008');
    assert.ok(finding, sql); assert.equal(finding.lockLevel, expected, sql);
    assert.equal(finding.lockDetails.blocks.includes('ACCESS SHARE'), expected === 'ACCESS EXCLUSIVE', sql);
    assert.match(finding.message, /session|role/i);
    assert.equal(JSON.parse(JSON.stringify(result)).violations.find(v => v.ruleId === 'LG-008').lockLevel, expected);
  }
});

test('The displayed index review does not claim ordinary SELECT is blocked by a timeout warning', () => {
  const result = engine.analyze('CREATE INDEX ix ON demo(user_id);');
  assert.equal(result.highestLockLevel, 'SHARE');
  assert.doesNotMatch(GitHubPrFormatter.format(result).split('\n---\n')[0], /ACCESS EXCLUSIVE|blocks everything/i);
  assert.equal(engine.getRules().find(r => r.id === 'LG-008').lockLevel, null);
});
