#!/usr/bin/env node
const {createBot:factory}=require('../src/bot/telegram-bot');
function formatAuditMessage(analysis, sql) {
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

  if(analysis.coverageComplete===false)return 'LockGuard: есть отключённые или подавленные проверки. Этот скрипт требует ручного разбора; полный положительный вывод не выдан.\n'+(analysis.violations||[]).map(v=>escape(v.ruleId+': '+v.message)).join('\n');
  if (analysis.passed && analysis.violationsCount===0) {
    return [
      `🛡️ <b>LockGuard: Аудит PostgreSQL миграции</b>`,
      `───────────────────────`,
      `✅ <b>СТАТУС: НАРУШЕНИЙ ПРАВИЛ НЕТ</b>`,
      ``,
      `Настроенные проверки не выявили замечаний. SQL может брать блокировки; нагрузка и границы транзакций требуют отдельной проверки.`,
      ``,
      `• Выведенная из SQL блокировка: <code>${escape(analysis.highestLockLevel || 'ACCESS SHARE')}</code>`,
      `• SQL не исполнялся. Реальные ожидания и простой не измерены.`,
      ``,
      `🌐 <i>Проверить визуально в песочнице:</i>`,
      `<a href="https://mars444456.github.io/lockguard/">mars444456.github.io/lockguard</a>`
    ].join('\n');
  }

  const lines = [
    `🛡️ <b>LockGuard: ЕСТЬ ЗАМЕЧАНИЯ ПРАВИЛ</b>`,
    `───────────────────────`,
    `<b>СТАТУС: ${analysis.passed?'ЗАМЕЧАНИЯ НИЖЕ ПОРОГА ОШИБКИ':'НУЖНА ПРОВЕРКА'} (${analysis.criticalCount} Critical)</b>`,
    ``,
    `• Выведенная из SQL блокировка: <b>${escape(analysis.highestLockLevel)}</b>`,
    `• SQL не исполнялся. Реальные ожидания и простой не измерены.`,
    ``,
    `🚨 <b>Найденные антипаттерны:</b>`
  ];

  analysis.violations.forEach((v, idx) => {
    lines.push(`<b>#${idx + 1}. ${escape(v.ruleName)}</b> (<code>${escape(v.ruleId)}</code>)`);
    lines.push(`• Таблица: <code>${escape(v.table || 'default')}</code> | Строка: L${escape(v.line || '1')}`);
    lines.push(`• Риск: ${escape(v.message)}`);
    if (v.safeFix) {
      lines.push(``);
      lines.push(`💡 <b>Рекомендация для ручной проверки:</b>`);
      lines.push(`<pre><code>${escape(v.safeFix)}</code></pre>`);
    }
    lines.push(`───────────────────────`);
  });

  lines.push(``);
  lines.push(`🌐 <b>Интерактивная песочница:</b>`);
  lines.push(`<a href="https://mars444456.github.io/lockguard/">https://mars444456.github.io/lockguard/</a>`);
  lines.push(``);
  lines.push(`💬 <b>Заказать полный аудит всей базы или настройку в CI/CD:</b>`);
  lines.push(`<a href="https://mars444456.github.io/lockguard/contacts.html">Контакты проекта LockGuard</a>`);

  return lines.join('\n');
}


function createBot(options={}) { return factory({...options,formatAuditMessage}); }
if(require.main===module) {
  try { require('node:process').loadEnvFile(); } catch(error) { if(error.code!=='ENOENT')throw error; }
  try { createBot().startPolling().catch(()=>{console.error('Telegram bot stopped. Check server configuration.');process.exitCode=1;}); }
  catch(error) { console.error(error.message);process.exitCode=1; }
}
module.exports={createBot,formatAuditMessage};
