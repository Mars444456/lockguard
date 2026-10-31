const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { LockMatrix } = require('../src/core/types');

// Independent transcription of PostgreSQL Table 13.2, rows and columns in order:
// https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-TABLES
const modes = ['ACCESS SHARE', 'ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'];
const expected = ['00000001', '00000011', '00001111', '00011111', '00110111', '00111111', '01111111', '11111111'];
function check(matrix) {
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    assert.equal(matrix[modes[row]].includes(modes[col]), expected[row][col] === '1', `${modes[row]} vs ${modes[col]}`);
  }
}
test('Core table locks match all 64 PostgreSQL conflict combinations', () => {
  check(Object.fromEntries(Object.entries(LockMatrix).map(([mode, value]) => [mode, value.blocks])));
});
for (const file of ['src/ui/app.js', 'docs/app.js']) {
  test(`${file} explorer matches all 64 PostgreSQL conflict combinations`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const declaration = source.match(/const PG_LOCK_CONFLICTS = \{[\s\S]*?\n\};/)[0];
    check(vm.runInNewContext(declaration + '\nPG_LOCK_CONFLICTS'));
  });
}
