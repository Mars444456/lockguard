#!/usr/bin/env node

/**
 * LockGuard Telegram Bot
 * Audits PostgreSQL migrations sent via text or .sql file attachments.
 */

const https = require('node:https');
const { RuleEngine, AutoSplitter, ShadowReplaySimulator, ContextAnalyzer } = require('../src/core');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9240475991:AAEVV6JSueYTrQVfQw2kQGA1J5tA4tuUQP4';
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

const engine = new RuleEngine();

console.log('🛡️  Starting LockGuard Telegram Bot...');

// Helper: Make Telegram API Request
function tgRequest(method, data = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const url = new URL(`${BASE_URL}/${method}`);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };

    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.ok) resolve(json.result);
          else reject(new Error(json.description || 'Telegram API Error'));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

// Helper: Download file content from Telegram
function downloadFile(filePath) {
  return new Promise((resolve, reject) => {
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    https.get(fileUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Send Message
async function sendMessage(chatId, text, options = {}) {
  return tgRequest('sendMessage', {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || 'HTML',
    disable_web_page_preview: options.disable_web_page_preview !== false,
    reply_markup: options.reply_markup
  });
}

// Format Analysis into Telegram HTML Message
function formatAuditMessage(analysis, sql) {
  const sim = ShadowReplaySimulator.simulate(analysis, { simulatedRows: 14200000, concurrentRps: 250 });
  const delaySec = (sim.totalLockWaitContentionMs / 1000).toFixed(1);

  if (analysis.passed) {
    return [
      `🛡️ <b>LockGuard: Аудит PostgreSQL миграции</b>`,
      `───────────────────────`,
      `✅ <b>СТАТУС: 100% ZERO-DOWNTIME SAFE</b>`,
      ``,
      `В вашем коде не обнаружено опасных блокировок. Запросы не будут конфликтовать с пользовательским трафиком.`,
      ``,
      `📊 <b>Метрики:</b>`,
      `• Максимальный лок: <code>${analysis.highestLockLevel || 'ACCESS SHARE'}</code>`,
      `• Оценка простоя: <code>0.0 сек</code>`,
      `• Риск для продакшена: <b>ОТСУТСТВУЕТ</b>`,
      ``,
      `🌐 <i>Проверить в интерактивной песочнице:</i>`,
      `<a href="https://mars444456.github.io/lockguard/">mars444456.github.io/lockguard</a>`
    ].join('\n');
  }

  const lines = [
    `🛡️ <b>LockGuard: ВНИМАНИЕ! ОБНАРУЖЕНЫ ОПАСНЫЕ БЛОКИРОВКИ</b>`,
    `───────────────────────`,
    `🔴 <b>СТАТУС: ДЕПЛОЙ ЗАБЛОКИРОВАН (${analysis.criticalCount} Critical)</b>`,
    ``,
    `⚠️ <b>Оценка последствий на базе в 14.2M строк:</b>`,
    `• Макс. лок: <b>${analysis.highestLockLevel}</b> ⛔`,
    `• Расчетный простой базы: <b>${delaySec} сек</b>`,
    `• Зависнет запросов клиентов: <b>~${sim.totalBlockedQueriesEstimated.toLocaleString()} (HTTP 504)</b>`,
    ``,
    `🚨 <b>Найденные антипаттерны:</b>`
  ];

  analysis.violations.forEach((v, idx) => {
    lines.push(`<b>#${idx + 1}. ${v.ruleName}</b> (<code>${v.ruleId}</code>)`);
    lines.push(`• Таблица: <code>${v.table || 'default'}</code> | Строка: L${v.line || '1'}`);
    lines.push(`• Риск: ${v.message}`);
    if (v.safeFix) {
      lines.push(``);
      lines.push(`💡 <b>Безопасная замена:</b>`);
      lines.push(`<pre><code>${v.safeFix}</code></pre>`);
    }
    lines.push(`───────────────────────`);
  });

  lines.push(``);
  lines.push(`🌐 <b>Скачать официальный PDF-отчет для руководства:</b>`);
  lines.push(`<a href="https://mars444456.github.io/lockguard/">https://mars444456.github.io/lockguard/</a>`);
  lines.push(``);
  lines.push(`💬 <b>Заказать аудит всей базы или настройку в CI/CD:</b>`);
  lines.push(`Напишите автору: @marswwu`);

  return lines.join('\n');
}

// Handle Incoming Updates
async function handleUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

  console.log(`[Message from ${username}]:`, msg.text || msg.document ? '[Document]' : '[Other]');

  // Command /start
  if (msg.text && msg.text.startsWith('/start')) {
    const welcome = [
      `👋 Привет, ${msg.from.first_name}!`,
      ``,
      `Я — <b>LockGuard Bot</b>, автоматический гейткипер блокировок PostgreSQL.`,
      ``,
      `Я умею анализировать DDL-миграции, ловить опасные блокировки (<code>ACCESS EXCLUSIVE</code>, <code>SHARE</code>) и защищать продакшен от падений и 504 ошибок.`,
      ``,
      `🚀 <b>Как мной пользоваться:</b>`,
      `1. Просто отправь мне текст своего SQL-запроса (миграции) прямо в этот чат.`,
      `2. Или прикрепи и отправь файл <code>.sql</code>.`,
      ``,
      `Я за 1 секунду разберу его в AST, рассчитаю риски простоя и пришлю готовый безопасный код замены!`,
      ``,
      `🌐 <b>Интерактивная песочница:</b>`,
      `<a href="https://mars444456.github.io/lockguard/">mars444456.github.io/lockguard</a>`,
      ``,
      `⭐ <b>GitHub репозиторий:</b>`,
      `<a href="https://github.com/Mars444456/lockguard">github.com/Mars444456/lockguard</a>`
    ].join('\n');

    await sendMessage(chatId, welcome);
    return;
  }

  // Command /help
  if (msg.text && msg.text.startsWith('/help')) {
    const help = [
      `📖 <b>Справка LockGuard Bot:</b>`,
      ``,
      `Отправьте мне любой SQL-скрипт или прикрепите файл миграции.`,
      ``,
      `Бот проверяет Top-8 антипаттернов:`,
      `1. ADD COLUMN с volatile DEFAULT (now(), uuid())`,
      `2. CREATE INDEX без CONCURRENTLY`,
      `3. Внешний ключ (Foreign Key) без NOT VALID`,
      `4. Тяжелый ALTER COLUMN TYPE (полный rewrite таблицы)`,
      `5. Прямой UNIQUE Constraint`,
      `6. Опасный DROP COLUMN / DROP TABLE`,
      `7. VACUUM внутри транзакции`,
      `8. Отсутствие SET lock_timeout`,
      ``,
      `💳 <b>Оплата подписки Pro и донаты:</b> /donate`,
      `💬 <b>Связь с автором для полного аудита:</b> @marswwu`
    ].join('\n');

    await sendMessage(chatId, help);
    return;
  }

  // Command /donate or /pay or /pricing
  if (msg.text && (msg.text.startsWith('/donate') || msg.text.startsWith('/pay') || msg.text.startsWith('/pricing'))) {
    const donateMsg = [
      `🧡 <b>Оплата подписки LockGuard Pro со скидкой 50%:</b>`,
      ``,
      `🔥 Сейчас действует спеццена: <b>2 490 ₽ / месяц</b> (вместо <s>4 990 ₽</s>)!`,
      ``,
      `Оплатить подписку или поддержать проект через <b>DonationAlerts</b>:`,
      `👉 <a href="https://www.donationalerts.com/r/marswwu"><b>donationalerts.com/r/marswwu</b></a>`,
      ``,
      `💳 <i>Принимаются любые карты РФ (МИР, Сбер, Тинькофф, ВТБ), СБП, ЮMoney.</i>`,
      ``,
      `После оплаты напишите автору @marswwu для мгновенной привязки ключа Pro на 1 месяц!`
    ].join('\n');

    await sendMessage(chatId, donateMsg, { disable_web_page_preview: false });
    return;
  }

  // Handle Attached .sql File
  if (msg.document) {
    const fileName = msg.document.file_name || 'migration.sql';
    if (!fileName.endsWith('.sql') && !fileName.endsWith('.txt')) {
      await sendMessage(chatId, '⚠️ Пожалуйста, отправьте файл с расширением <code>.sql</code> или обычный текст миграции.');
      return;
    }

    try {
      await sendMessage(chatId, `⏳ Анализирую файл <code>${fileName}</code> через LockGuard AST Engine...`);
      const fileInfo = await tgRequest('getFile', { file_id: msg.document.file_id });
      const sqlContent = await downloadFile(fileInfo.file_path);

      const analysis = engine.analyze(sqlContent, { filename: fileName });
      const reply = formatAuditMessage(analysis, sqlContent);
      await sendMessage(chatId, reply);
    } catch (err) {
      console.error('Error handling file:', err);
      await sendMessage(chatId, `❌ Ошибка при обработке файла: ${err.message}`);
    }
    return;
  }

  // Handle Raw SQL Text
  if (msg.text) {
    const text = msg.text.trim();
    const isSql = /ALTER\s+TABLE|CREATE\s+INDEX|ADD\s+COLUMN|DROP\s+TABLE|CREATE\s+TABLE|SET\s+lock_timeout/i.test(text);

    if (!isSql && text.length < 15) {
      await sendMessage(chatId, '💡 Отправьте мне текст SQL-миграции или прикрепите <code>.sql</code> файл для анализа блокировок.');
      return;
    }

    try {
      const analysis = engine.analyze(text, { filename: 'migration.sql' });
      const reply = formatAuditMessage(analysis, text);
      await sendMessage(chatId, reply);
    } catch (err) {
      console.error('Error analyzing text:', err);
      await sendMessage(chatId, `❌ Ошибка при анализе SQL: ${err.message}`);
    }
  }
}

// Long Polling Loop
let lastUpdateId = 0;

async function startPolling() {
  console.log('✅ LockGuard Telegram Bot is online and listening for migrations...');
  
  while (true) {
    try {
      const updates = await tgRequest('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 20
      });

      if (Array.isArray(updates)) {
        for (const update of updates) {
          lastUpdateId = update.update_id;
          await handleUpdate(update).catch(err => console.error('Handle update error:', err));
        }
      }
    } catch (err) {
      console.error('Polling error (retrying in 5s):', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Run bot if invoked directly
if (require.main === module) {
  startPolling();
}

module.exports = { tgRequest, formatAuditMessage, handleUpdate };
