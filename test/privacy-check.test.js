const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scanRepository, assertPublishable } = require('../scripts/check-privacy');

function repository(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-privacy-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd, windowsHide: true });
  return cwd;
}
function stage(cwd, file, value) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), value);
  execFileSync('git', ['add', '--', file], { cwd, windowsHide: true });
}
const snapshot = `https://${'chatgpt.com'}/s/synthetic-private-snapshot`;

test('Privacy check catches a staged chat link after the working file has been cleaned, without logging its contents', t => {
  const cwd = repository(t);
  stage(cwd, 'README.md', `Demo\n${snapshot}\n`);
  fs.writeFileSync(path.join(cwd, 'README.md'), 'Demo\n');
  assert.deepEqual(scanRepository(cwd).findings, [{ file: 'README.md', rule: 'conversation-link', line: 2 }]);
  assert.throws(() => assertPublishable(cwd), error => {
    assert.match(error.message, /README\.md.*:2/);
    assert.ok(!error.message.includes('synthetic-private-snapshot'));
    assert.ok(!error.message.includes(snapshot));
    return true;
  });
});

test('Privacy check catches working changes and JSON-escaped chat URLs in generated pages', t => {
  const cwd = repository(t);
  stage(cwd, 'docs/index.html', 'Public demo\n');
  fs.writeFileSync(path.join(cwd, 'docs/index.html'), JSON.stringify({ url: snapshot }).replaceAll('/', '\\/'));
  assert.equal(scanRepository(cwd).findings[0].rule, 'conversation-link');
});

test('Privacy check blocks private tracked paths and key material while allowing the environment template', t => {
  const cwd = repository(t);
  for (const file of ['.env.production', 'private/session.txt', 'data/accounts.sqlite3', 'backup.db.json']) stage(cwd, file, 'synthetic');
  stage(cwd, '.env.example', 'TOKEN=\n');
  stage(cwd, 'deploy.txt', ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' '));
  const findings = scanRepository(cwd).findings;
  assert.equal(findings.filter(f => f.rule === 'private-file').length, 4);
  assert.ok(findings.some(f => f.file === 'deploy.txt' && f.rule === 'private-key'));
  assert.ok(!findings.some(f => f.file === '.env.example'));
});

test('Privacy check allows public project resources and does not inspect untracked local files', t => {
  const cwd = repository(t);
  stage(cwd, 'README.md', 'https://github.com/example/project\nhttps://chatgpt.com/\nhttps://developers.openai.com/\n');
  stage(cwd, '.env.example', 'API_KEY=\n');
  fs.writeFileSync(path.join(cwd, '.env'), snapshot);
  assert.equal(assertPublishable(cwd).findings.length, 0);
});

test('Privacy check stops when no Git index can be inspected', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lockguard-no-index-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  assert.throws(() => assertPublishable(cwd), /could not read the Git index/);
});

test('Privacy check blocks internal archives and personal workstation links', t => {
  const cwd = repository(t);
  for (const file of ['reports/internal.md', 'IDEA.md', 'docs/habr_draft.txt']) stage(cwd, file, 'Internal draft');
  stage(cwd, 'README.md', 'file:' + '///D:/workspace/document.md\n' + 'C:' + '/Users/synthetic/Documents/file.md');
  const findings = scanRepository(cwd).findings;
  assert.equal(findings.filter(f => f.rule === 'private-file').length, 3);
  assert.equal(findings.filter(f => f.rule === 'local-personal-path').length, 2);
});

test('Seller details stay in business documents and cannot return to the README or landing page', t => {
  const cwd = repository(t);
  const seller = { name: 'Synthetic Seller', inn: '000000000000', email: 'seller@example.invalid' };
  stage(cwd, 'config/seller.json', JSON.stringify(seller));
  stage(cwd, 'docs/contacts.html', seller.name + ' ' + seller.inn + ' ' + seller.email);
  stage(cwd, 'README.md', seller.email);
  stage(cwd, 'docs/index.html', seller.inn);
  const findings = scanRepository(cwd).findings;
  assert.deepEqual(findings.map(f => f.file).sort(), ['README.md', 'docs/index.html']);
  assert.ok(findings.every(f => f.rule === 'seller-details-outside-documents'));
});
