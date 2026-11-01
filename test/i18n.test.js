require('./helpers/initialize');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML, DOMParser } = require('linkedom');
const { RuleEngine, AutoSplitter, ShadowReplaySimulator } = require('../src/core');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function page(file = 'docs/index.html', { query = '', saved = null, browserLanguage = 'ru-RU', blockedStorage = false, beforeInit } = {}) {
  const { document, window: dom } = parseHTML(read(file));
  const storage = new Map(saved ? [['lockguard.language', saved]] : []);
  const window = { location: new URL('https://example.invalid/' + path.basename(file) + query), addEventListener() {} };
  window.history = { state: null, replaceState(state, unused, address) { window.location = new URL(address); } };
  const scope = { window, document, URL, DOMParser, CustomEvent: dom.CustomEvent, MutationObserver: dom.MutationObserver,
    navigator: { language: browserLanguage, clipboard: { writeText: async () => {} } }, console, setTimeout, clearTimeout,
    localStorage: { getItem(key) { if (blockedStorage) throw new Error('blocked'); return storage.get(key); }, setItem(key, value) { if (blockedStorage) throw new Error('blocked'); storage.set(key, value); } } };
  vm.createContext(scope);
  vm.runInContext(read('src/ui/i18n-catalog.js'), scope);
  beforeInit?.(document);
  vm.runInContext(read('src/ui/i18n.js'), scope);
  return { window, document, scope, storage, i18n: window.LockGuardI18n };
}

test('Language URLs override saved preferences and browser detection; invalid values are ignored', () => {
  assert.equal(page(undefined, { query: '?lang=en', saved: 'ru' }).i18n.language, 'en');
  assert.equal(page(undefined, { query: '?lang=invalid', saved: 'en' }).i18n.language, 'en');
  assert.equal(page(undefined, { browserLanguage: 'en-US', blockedStorage: true }).i18n.language, 'en');
  assert.equal(page(undefined, { blockedStorage: true }).i18n.language, 'ru');
});

test('Switching updates labels, document language, accessible names and links while preserving editor state', () => {
  const { document, window, i18n, storage } = page(undefined, { query: '?campaign=pilot#sql=unchanged' });
  const editor = document.getElementById('sql-input');
  const sql = 'SELECT "Правила", \'Войти\' FROM "Тарифы";'; editor.value = sql;
  document.querySelector('[data-language="en"]').click();
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.getElementById('btn-analyze').textContent, 'Review SQL');
  assert.equal(document.querySelector('.hero-title').textContent, 'Schema changes —under control.');
  assert.equal(document.querySelector('.brand').getAttribute('aria-label'), 'LockGuard — home');
  assert.equal(document.querySelector('[data-language="en"]').getAttribute('aria-pressed'), 'true');
  assert.equal(editor.value, sql);
  assert.equal(window.location.hash, '#sql=unchanged');
  assert.equal(window.location.searchParams.get('campaign'), 'pilot');
  assert.equal(window.location.searchParams.get('lang'), 'en');
  assert.equal(storage.get('lockguard.language'), 'en');
  assert.ok(document.querySelector('a[href*="contacts.html"]').getAttribute('href').includes('lang=en'));
  i18n.setLanguage('ru');
  assert.equal(document.getElementById('btn-analyze').textContent, 'Проверить SQL');
  assert.equal(editor.value, sql);
});

test('Translations preserve form values, user names and SQL snippets even when they match UI phrases', async () => {
  const { document, i18n } = page('src/ui/index.html');
  document.getElementById('account-email').value = 'qa@example.invalid';
  document.getElementById('account-password').value = 'Пароль Войти Тарифы';
  document.getElementById('account-organization').value = 'Правила';
  const name = document.getElementById('org-name'); name.setAttribute('data-i18n-ignore', ''); name.textContent = 'Войти';
  const code = document.createElement('div'); code.className = 'fix-code'; code.textContent = 'Проверить SQL'; document.body.appendChild(code);
  i18n.setLanguage('en'); await flush();
  assert.equal(name.textContent, 'Войти');
  assert.equal(code.textContent, 'Проверить SQL');
  assert.equal(document.getElementById('account-password').value, 'Пароль Войти Тарифы');
  assert.equal(document.getElementById('account-organization').value, 'Правила');
  assert.equal(document.getElementById('account-password').placeholder, 'At least 12 characters');
  assert.equal(document.getElementById('account-auth-submit').textContent, 'Sign in');
  i18n.setLanguage('ru'); await flush();
  assert.equal(name.textContent, 'Войти');
  assert.equal(document.getElementById('account-email').value, 'qa@example.invalid');
});

test('New asynchronous UI messages and numbered findings follow the selected language and can switch back', async () => {
  const { document, i18n } = page(undefined, { query: '?lang=en' });
  const result = document.createElement('div'); result.textContent = 'Найдены риски · 3'; document.body.appendChild(result);
  const title = document.createElement('div'); title.textContent = '#1. Индекс создаётся без CONCURRENTLY ('; document.body.appendChild(title);
  await flush();
  assert.equal(result.textContent, 'Risks found · 3');
  assert.equal(title.textContent, '#1. Index built without CONCURRENTLY (');
  i18n.setLanguage('ru'); await flush();
  assert.equal(result.textContent, 'Найдены риски · 3');
  result.textContent = 'Copied'; await flush();
  assert.equal(result.textContent, 'Скопировано');
  result.textContent = 'Ошибка анализа'; await flush();
  i18n.setLanguage('en');
  assert.equal(result.textContent, 'Analysis error');
});

test('Public analysis and English PDF retain input SQL and the rule result', async () => {
  const { window, document, scope, i18n } = page(undefined, { query: '?lang=en' });
  const engine = new RuleEngine(); let report;
  window.LockGuard = { ready: RuleEngine.initialize(), analyze: (...args) => engine.analyze(...args), simulate: (...args) => ShadowReplaySimulator.simulate(...args), generatePlan: (...args) => AutoSplitter.generatePlan(...args) };
  window.open = () => ({ document: { open() {}, write(value) { report = value; }, close() {} } });
  scope.alert = value => { throw new Error(value); };
  vm.runInContext(read('src/ui/labels.js'), scope);
  vm.runInContext(read('docs/app.js') + '\nthis.Playground = LockGuardWebPlayground;', scope);
  const app = new scope.Playground();
  const sql = "SET lock_timeout='3s'; CREATE INDEX ix ON orders(id);";
  app.sqlInput.value = sql;
  await app.runAnalysis(); await flush();
  assert.ok(document.querySelector('.violation-title').textContent.includes('Index built without CONCURRENTLY'));
  const originalResult = app.lastAnalysis;
  i18n.setLanguage('ru'); await flush();
  assert.equal(app.sqlInput.value, sql);
  assert.equal(app.lastAnalysis, originalResult);
  i18n.setLanguage('en');
  await app.exportPdfReport();
  assert.match(report, /lang="en"/);
  assert.equal(app.sqlInput.value, sql);
  assert.ok(report.includes('orders'));
  assert.ok(report.includes('Save as PDF'));
  assert.ok(!report.includes('Сохранить как PDF'));
  const printed = parseHTML(report).document;
  const untranslated = [];
  const walk = node => {
    if (node.nodeType === 3 && /[А-Яа-яЁё]/.test(node.data) && !node.parentElement.closest('script,style,pre,code,[data-i18n-ignore]')) untranslated.push(node.data.trim());
    else if (node.nodeType === 1) for (const child of node.childNodes) walk(child);
  };
  walk(printed.body);
  assert.deepEqual(untranslated, []);
});

test('Each public page exposes a functioning switch and translated primary content', () => {
  for (const [file, englishTitle] of [['start.html','Your first 10 minutes with LockGuard'],['contacts.html','Contact and provider details'],['offer.html','Public offer'],['privacy.html','Privacy policy']]) {
    const { document, i18n } = page('docs/' + file, { query: '?lang=en' });
    assert.equal(document.querySelectorAll('.language-switcher').length, 1, file);
    assert.ok(document.title.includes(englishTitle), file + ': ' + document.title);
    const untranslated = [];
    const walk = node => {
      if (node.nodeType === 3 && /[А-Яа-яЁё]/.test(node.data) && !node.parentElement.closest('script,style,pre,code,textarea,noscript,[data-i18n-ignore],.language-switcher')) untranslated.push(node.data.trim());
      else if (node.nodeType === 1) for (const child of node.childNodes) walk(child);
    };
    walk(document.body);
    assert.deepEqual(untranslated, [], file);
    const mail = document.querySelector('a[href^="mailto:"]');
    if (mail) assert.equal(mail.getAttribute('href'), 'mailto:' + JSON.parse(read('config/seller.json')).email);
    i18n.setLanguage('ru');
    assert.equal(document.documentElement.lang, 'ru');
  }
});

test('Parameterized translation values are plain text, not HTML or replacement instructions', () => {
  const { document, i18n } = page(undefined, { query: '?lang=en' });
  const error = document.createElement('p'); error.textContent = 'Ошибка анализа: <img src=x onerror=alert(1)> $&'; document.body.appendChild(error);
  i18n.translateTree(error);
  assert.equal(error.textContent, 'Analysis error: <img src=x onerror=alert(1)> $&');
  assert.equal(error.querySelector('img'), null);
});

test('Initial language selection also translates labels synchronously rebuilt by workspace components', () => {
  const { document } = page(undefined, { query: '?lang=en', beforeInit(document) {
    document.addEventListener('lockguard:language', () => {
      document.getElementById('verdict-badge').textContent = 'PRO · сохранённые схемы';
    });
  } });
  assert.equal(document.getElementById('verdict-badge').textContent, 'PRO · saved schemas');
});

test('The actual ephemeral server notice follows the workspace language', () => {
  const banner = read('src/server/server.js').match(/const banner = '([^']+)';/)[1];
  const { document, i18n } = page('src/ui/index.html', { query: '?lang=en', beforeInit(document) {
    const wrapper = document.createElement('div'); wrapper.innerHTML = banner;
    document.body.prepend(wrapper);
  } });
  assert.equal(document.querySelector('aside[role="note"]').textContent,
    'Test environment: accounts, history and schemas may reset on restart. Use sample data only.');
  i18n.setLanguage('ru');
  assert.ok(document.querySelector('aside[role="note"]').textContent.startsWith('Тестовый стенд:'));
});
