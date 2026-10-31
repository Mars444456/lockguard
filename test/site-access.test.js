const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { siteConfig } = require('../scripts/build-site-links');
const root = path.resolve(__dirname, '..');

test('A public account destination must be an HTTPS application server, not Pages or an injected credential URL', () => {
  const donationUrl = 'https://www.donationalerts.com/r/marswwu';
  assert.equal(siteConfig({ donationUrl, applicationUrl: 'https://app.example.com' }).applicationUrl, 'https://app.example.com/#account');
  for (const applicationUrl of ['http://localhost:3000', 'https://mars444456.github.io/lockguard/', 'https://user:password@app.example.com', 'javascript:alert(1)', 'https://app.example.com/?redirect=elsewhere']) {
    assert.throws(() => siteConfig({ donationUrl, applicationUrl }));
  }
});

test('The public sign-in entry explains unavailable accounts without accepting credentials or calling an API', () => {
  // Exercise unconfigured mode even after a real public server is configured.
  const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8').replace(
    /<!-- public-account:start -->[\s\S]*?<!-- public-account:end -->/,
    '<a id="public-account-link" href="#account-access">Войти</a>');
  const { document, Event } = parseHTML(html);
  const dialog = document.getElementById('account-access-dialog');
  const entry = document.getElementById('public-account-link');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  let focused = false;
  document.getElementById('sql-input').focus = () => { focused = true; };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/ui/site-access.js'), 'utf8'), { document });
  entry.dispatchEvent(new Event('click', { cancelable: true }));
  assert.equal(dialog.open, true);
  assert.ok(dialog.textContent.includes('Кабинет ещё не опубликован'));
  assert.equal(dialog.querySelector('input, form'), null);
  assert.equal(dialog.querySelector('a.btn-primary').getAttribute('href'), 'http://localhost:3000/#account');
  dialog.querySelector('[data-continue-analysis]').click();
  assert.equal(dialog.open, false);
  assert.equal(focused, true);
});

test('Public and server pages link to the same voluntary donation and keep it separate from Pro', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/site.json'), 'utf8'));
  for (const directory of ['docs', 'src/ui']) {
    const { document } = parseHTML(fs.readFileSync(path.join(root, directory, 'index.html'), 'utf8'));
    const links = document.querySelectorAll('a.donation-link');
    assert.equal(links.length, 2);
    for (const link of links) {
      assert.equal(link.getAttribute('href'), config.donationUrl);
      assert.equal(link.getAttribute('target'), '_blank');
      assert.ok(link.getAttribute('rel').includes('noopener'));
    }
    assert.ok(document.querySelector('.support-project').textContent.includes('Доступ Pro оформляется отдельно'));
  }
});
