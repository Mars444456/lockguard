/* Local UI translations only. SQL, secrets, reports and user-supplied names are never translated. */
(() => {
  'use strict';
  const catalog = window.LockGuardTranslations || [];
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  const direct = new Map(catalog.filter(([source]) => !source.includes('{')));
  const reverse = new Map();
  for (const [source, target] of direct) if (!reverse.has(target)) reverse.set(target, source);
  const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = catalog.filter(([source]) => /\{\d+\}/.test(source)).map(([source, target]) => {
    const keys = [];
    const expression = source.split(/(\{\d+\})/).map(part => {
      if (/^\{\d+\}$/.test(part)) { keys.push(part); return '(.+?)'; }
      return escapePattern(part);
    }).join('');
    return { expression: new RegExp('^' + expression + '$'), keys, target };
  });
  const protectedSelector = 'script,style,pre,code,textarea,input,[contenteditable="true"],[data-i18n-ignore],.language-switcher,#current-filename,#account-profile-email,#res-tables-list,#res-affected-tables,#pr-markdown-box,#run-report-body,.schema-profile-card h3,.fix-code,.violation-desc,.technical-message p';
  const textSources = new WeakMap(), attributeSources = new WeakMap(), linkSources = new WeakMap();
  let language = 'ru', observer;
  function storedLanguage() { try { return localStorage.getItem('lockguard.language'); } catch { return null; } }
  function initialLanguage() {
    let parameter;
    try { parameter = new URL(window.location.href).searchParams.get('lang'); } catch {}
    return [parameter, storedLanguage(), navigator.language?.startsWith('en') ? 'en' : 'ru'].find(value => value === 'ru' || value === 'en');
  }
  language = initialLanguage();
  function t(value, selected = language) {
    if (typeof value !== 'string') return value;
    const source = normalize(value);
    if (selected === 'ru') {
      const original = reverse.get(source);
      return original === undefined ? value : (value.match(/^\s*/)?.[0] || '') + original + (value.match(/\s*$/)?.[0] || '');
    }
    let translated = direct.get(source);
    // Numbered rule titles and severity badges contain only known UI labels.
    if (translated === undefined) {
      const numbered = /^(#?\d+\.\s+)(.+?)(\s+\()?$/.exec(source);
      if (numbered && direct.has(numbered[2])) translated = numbered[1] + direct.get(numbered[2]) + (numbered[3] || '');
      const severity = /^(Критический|Высокий|Средний|Низкий)(\s*[•·]\s*.+)$/.exec(source);
      if (severity && direct.has(severity[1])) translated = direct.get(severity[1]) + severity[2];
    }
    if (translated === undefined && source.length <= 5000) {
      for (const pattern of patterns) {
        const match = pattern.expression.exec(source);
        if (!match) continue;
        const variables = new Map(pattern.keys.map((key, index) => [key, match[index + 1]]));
        translated = pattern.target.replace(/\{\d+\}/g, key => variables.get(key) ?? key);
        break;
      }
    }
    if (translated === undefined) return value;
    return (value.match(/^\s*/)?.[0] || '') + translated + (value.match(/\s*$/)?.[0] || '');
  }
  function protectedNode(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    return !element || !!element.closest(protectedSelector);
  }
  function translateText(node, selected) {
    if (protectedNode(node)) return;
    let binding = textSources.get(node);
    if (!binding || node.data !== binding.rendered) binding = { source: node.data };
    const output = t(binding.source, selected);
    binding.rendered = output;
    textSources.set(node, binding);
    if (node.data !== output) node.data = output;
  }
  function translateAttributes(element, selected) {
    if (element.matches('script,style,[data-i18n-ignore],.language-switcher,.language-switcher *')) return;
    let bindings = attributeSources.get(element);
    if (!bindings) { bindings = {}; attributeSources.set(element, bindings); }
    for (const name of ['aria-label', 'placeholder', 'title']) {
      const current = element.getAttribute(name);
      if (current === null) continue;
      let binding = bindings[name];
      if (!binding || current !== binding.rendered) binding = { source: current };
      const output = t(binding.source, selected); binding.rendered = output; bindings[name] = binding;
      if (current !== output) element.setAttribute(name, output);
    }
    if (element.matches('meta[name="description"]')) {
      let binding = bindings.content;
      const current = element.getAttribute('content');
      if (!binding || current !== binding.rendered) binding = { source: current };
      const output = t(binding.source, selected); binding.rendered = output; bindings.content = binding;
      if (current !== output) element.setAttribute('content', output);
    }
  }
  function localizeLink(element, selected) {
    if (element.tagName !== 'A') return;
    const current = element.getAttribute('href');
    if (!current || current.startsWith('#')) return;
    let binding = linkSources.get(element);
    if (!binding || current !== binding.rendered) binding = { source: current };
    try {
      const url = new URL(binding.source, window.location.href);
      if (url.origin === 'https://github.com' && url.pathname === '/Mars444456/lockguard' && ['#readme', '#быстрый-запуск', '#' + encodeURIComponent('быстрый-запуск')].includes(url.hash)) {
        if (selected === 'en') { url.pathname += '/blob/main/README.en.md'; url.hash = url.hash === '#readme' ? '' : '#quick-start'; }
        binding.rendered = url.href; linkSources.set(element, binding);
        if (current !== binding.rendered) element.setAttribute('href', binding.rendered);
        return;
      }
      const own = url.origin === window.location.origin || ['https://mars444456.github.io', 'https://lockguard-test-cabinet.onrender.com'].includes(url.origin) || url.hostname === 'localhost';
      if (!own || !['http:', 'https:', 'file:'].includes(url.protocol) || !/(?:\/|\.html)$/.test(url.pathname)) return;
      url.searchParams.set('lang', selected);
      binding.rendered = url.href; linkSources.set(element, binding);
      if (current !== binding.rendered) element.setAttribute('href', binding.rendered);
    } catch {}
  }
  function translateTree(root, selected = language, links = true) {
    if (root.nodeType === 3) { translateText(root, selected); return; }
    if (root.nodeType === 1) {
      translateAttributes(root, selected);
      if (links) localizeLink(root, selected);
      if (protectedNode(root)) return;
    }
    for (const child of [...root.childNodes]) translateTree(child, selected, links);
  }
  function updateControls() {
    for (const button of document.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
  function setLanguage(value, { persist = true, updateUrl = true } = {}) {
    if (!['ru', 'en'].includes(value)) return;
    language = value;
    document.documentElement.lang = value;
    if (persist) try { localStorage.setItem('lockguard.language', value); } catch {}
    if (updateUrl) try {
      const url = new URL(window.location.href); url.searchParams.set('lang', value);
      window.history.replaceState(window.history.state, '', url.href);
    } catch {}
    document.dispatchEvent(new CustomEvent('lockguard:language', { detail: { language } }));
    // Let workspace components rebuild their labels before binding the current DOM.
    translateTree(document.documentElement);
    updateControls();
  }
  function translateHtml(source) {
    if (language === 'ru') return source;
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    translateTree(parsed.documentElement, language, false);
    parsed.documentElement.lang = language;
    return '<!doctype html>\n' + parsed.documentElement.outerHTML;
  }
  function init() {
    if (document.querySelector('.language-switcher')) return;
    const control = document.createElement('div'); control.className = 'language-switcher';
    control.setAttribute('role', 'group'); control.setAttribute('aria-label', 'Language / Язык');
    for (const [value, label] of [['ru', 'RU'], ['en', 'EN']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.dataset.language = value; button.lang = value; button.setAttribute('aria-label', value === 'ru' ? 'Русский' : 'English');
      button.addEventListener('click', () => setLanguage(value)); control.appendChild(button);
    }
    const target = document.querySelector('.nav-actions') || document.querySelector('header nav') || document.querySelector('.legal-page nav') || document.querySelector('header');
    if (target) target.appendChild(control); else document.body.prepend(control);
    setLanguage(language, { persist: false, updateUrl: false });
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(records => {
        observer.disconnect();
        const roots = new Set();
        for (const record of records) {
          if (record.type === 'characterData') roots.add(record.target);
          else for (const node of record.addedNodes) roots.add(node);
        }
        for (const root of roots) if (root.isConnected) translateTree(root);
        observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
      });
      observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener?.('popstate', () => setLanguage(initialLanguage(), { persist: false, updateUrl: false }));
  }
  window.LockGuardI18n = { t, setLanguage, translateTree, translateHtml, get language() { return language; }, get locale() { return language === 'en' ? 'en-US' : 'ru-RU'; } };
  document.documentElement.lang = language;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
