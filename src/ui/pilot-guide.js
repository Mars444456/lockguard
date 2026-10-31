(() => {
  const example = window.LockGuardPilotExample;
  if (!example) { document.getElementById('finding-count').textContent = 'Пример недоступен'; return; }
  const descriptions = {
    withoutSchema: ['Только миграция', 'LG-002 отмечает построение индекса с блокировкой записи. LG-011 просит подтвердить индекс для внешнего ключа: в самой миграции его нет, но в существующей схеме он есть.'],
    before: ['Со снимком схемы', 'Импортированная структура подтверждает индекс orders(account_id), поэтому LG-011 не появляется. Замечание LG-002 о новом обычном индексе остаётся.'],
    after: ['После изменения', 'CREATE INDEX заменён на CONCURRENTLY вне транзакции. В сравнении на одном снимке схемы LG-002 устранён; новых замечаний нет. Это не проверка на работающей базе.']
  };
  let selected = 'withoutSchema';
  function render(name) {
    if (!descriptions[name]) return;
    selected = name;
    const result = example[name], sql = name === 'after' ? example.afterSql : example.beforeSql;
    for (const button of document.querySelectorAll('[data-case]')) button.setAttribute('aria-pressed', String(button.dataset.case === name));
    document.getElementById('case-title').textContent = descriptions[name][0];
    document.getElementById('case-explanation').textContent = descriptions[name][1];
    const count = result.findings.length;
    document.getElementById('finding-count').textContent = `${count} ${count === 1 ? 'замечание' : count >= 2 && count <= 4 ? 'замечания' : 'замечаний'}`;
    document.getElementById('example-sql').textContent = sql;
    document.getElementById('copy-status').textContent = '';
    document.getElementById('open-example').href = 'index.html#sql=' + encodeURIComponent(sql);
    const list = document.getElementById('example-findings');
    list.replaceChildren();
    for (const finding of result.findings) {
      const item = document.createElement('li'), title = document.createElement('b'), message = document.createElement('span');
      title.textContent = `${finding.ruleId} · ${finding.severity}`;
      message.textContent = finding.message;
      item.append(title, message); list.append(item);
    }
    if (!result.findings.length) {
      const item = document.createElement('li'); item.className = 'clear';
      item.textContent = result.analysisComplete ? 'В этом примере замечаний нет. Проверьте миграцию на тестовой базе.' : 'Анализ неполный. Нужна ручная проверка.';
      list.append(item);
    }
  }
  for (const button of document.querySelectorAll('[data-case]')) button.addEventListener('click', () => render(button.dataset.case));
  document.getElementById('copy-sql').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(selected === 'after' ? example.afterSql : example.beforeSql);
      document.getElementById('copy-status').textContent = 'SQL скопирован.';
    } catch { document.getElementById('copy-status').textContent = 'Не удалось скопировать автоматически. Выделите SQL в блоке выше.'; }
  });
  document.getElementById('example-schema').textContent = example.schemaSql;
  document.getElementById('comparison-summary').textContent = `Устранено: ${example.comparison.resolved.length} · новых: ${example.comparison.introduced.length}`;
  render(selected);
})();
