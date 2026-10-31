require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { RuleEngine } = require('../src/core');
const html = fs.readFileSync(path.join(__dirname, '../src/ui/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');

async function page({ hash = '' } = {}) {
  const { document, Event } = parseHTML(html);
  for (const form of document.querySelectorAll('form')) form.reset = function() { for (const input of this.querySelectorAll('input')) input.value = ''; };
  const user = { id: 'user-a', email: 'alice@example.invalid', organizationId: 'org-a' };
  const organization = { id: 'org-a', name: 'Alice team', plan: 'free' };
  const engine = new RuleEngine();
  const requests = [];
  let authenticated = false, delayedKeys;
  const respond = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const window = { location: { search: '', hash }, prompt: () => null };
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/v1/auth/session') return respond({ user: authenticated ? user : null, registrationEnabled: true });
    if (url === '/api/v1/auth/login' || url === '/api/v1/auth/register') { authenticated = true; return respond({ user, organization }); }
    if (url === '/api/v1/auth/logout') { authenticated = false; return respond({ success: true }); }
    if (url === '/api/v1/analyze') return respond({ data: { ...engine.analyze(JSON.parse(options.body).sql), markdownReport: 'report' } });
    if (url === '/api/v1/organization') return respond({ organization });
    if (url === '/api/v1/rules') return respond({ rules: [] });
    if (url === '/api/v1/runs') return respond({ runs: [] });
    if (url === '/api/v1/keys') return delayedKeys ? delayedKeys() : respond({ keys: [] });
    throw new Error('Unexpected request ' + url);
  };
  const scope = { window, document, Event, fetch, Headers, URLSearchParams, console, navigator: { clipboard: { writeText: async () => {} } },
    setTimeout: (fn, ms) => ms === 3500 ? 0 : setTimeout(fn, ms), clearTimeout };
  vm.runInNewContext(script, scope);
  await window.app.ready;
  return { app: window.app, document, user, requests, respond, delayKeys: handler => { delayedKeys = handler; } };
}

test('Account form switches registration mode, signs in and clears passwords after submission', async () => {
  const { app, document, user, requests } = await page();
  app.setAccountMode('register');
  assert.equal(document.getElementById('account-organization-field').hidden, false);
  assert.equal(document.getElementById('account-organization').required, true);
  document.getElementById('account-email').value = user.email;
  document.getElementById('account-password').value = 'Correct test password 2026';
  document.getElementById('account-organization').value = 'Alice team';
  await app.submitAccount();
  assert.equal(app.account.id, user.id);
  assert.equal(document.getElementById('account-profile').hidden, false);
  assert.equal(document.getElementById('org-name').textContent, 'Alice team');
  assert.equal(document.getElementById('account-password').value, '');
  assert.equal(document.getElementById('btn-account-logout').hidden, false);
  assert.ok(requests.every(request => request.options.credentials === 'same-origin'));
});

test('Header registration button opens the registration form directly', async () => {
  const { app, document } = await page();
  document.getElementById('btn-account-register').click();
  assert.equal(document.getElementById('account-panel').hidden, false);
  assert.equal(document.getElementById('account-organization-field').hidden, false);
  assert.equal(document.getElementById('account-mode-register').getAttribute('aria-pressed'), 'true');
  assert.equal(document.getElementById('account-auth-submit').textContent, 'Создать аккаунт');
  assert.equal(app.accountMode, 'register');
});

test('The account entry link opens the real server sign-in form', async () => {
  const { document } = await page({ hash: '#account' });
  assert.equal(document.getElementById('account-panel').hidden, false);
  assert.equal(document.getElementById('btn-account').getAttribute('aria-expanded'), 'true');
  assert.equal(document.getElementById('account-auth-submit').textContent, 'Войти');
});

test('History opens the stored report as text and logout removes it', async () => {
  const { app, document } = await page();
  app.runs = [{ id: 'saved-run', markdownReport: 'Report for qa_orders <script>unsafe</script>' }];
  app.viewRunDetails('saved-run');
  assert.equal(document.getElementById('run-report').hidden, false);
  assert.equal(document.getElementById('run-report-body').textContent, app.runs[0].markdownReport);
  assert.equal(document.getElementById('run-report-body').querySelector('script'), null);
  app.resetPrivateData();
  assert.equal(document.getElementById('run-report').hidden, true);
  assert.equal(document.getElementById('run-report-body').textContent, '');
});

test('Logout clears private keys, history, payment links, SQL and profile values from the page', async () => {
  const { app, document, user } = await page();
  app.account = user;
  document.getElementById('keys-tbody').innerHTML = '<tr><td>Alice secret</td></tr>';
  document.getElementById('runs-tbody').innerHTML = '<tr><td>Alice history</td></tr>';
  document.getElementById('billing-payment-link').value = 'https://example.invalid/private-order';
  document.getElementById('account-organization-name').value = 'Private name';
  document.getElementById('sql-input').value = 'SELECT private_data;';
  await app.signOut();
  assert.equal(app.account, null);
  for (const id of ['keys-tbody', 'runs-tbody']) assert.equal(document.getElementById(id).textContent, '');
  for (const id of ['billing-payment-link', 'sql-input', 'account-organization-name']) assert.equal(document.getElementById(id).value, '');
  assert.equal(document.getElementById('account-profile').hidden, true);
  assert.equal(document.getElementById('org-name').textContent, 'Гость');
});

test('Delayed responses from an old account cannot repopulate private data after logout', async () => {
  const { app, document, user, respond, delayKeys } = await page();
  app.account = user;
  let finish;
  delayKeys(() => new Promise(resolve => { finish = resolve; }));
  const loading = app.fetchKeys();
  app.resetPrivateData();
  finish(respond({ keys: [{ id: 'private', name: 'Old account key', key: 'lg_private', status: 'active' }] }));
  await loading;
  assert.equal(document.getElementById('keys-tbody').textContent, '');
  assert.equal(document.getElementById('org-name').textContent, 'Гость');
});
