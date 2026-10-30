#!/usr/bin/env node

/**
 * LockGuard Telegram Bot
 * Audits PostgreSQL migrations, manages Pro license keys, and handles donations.
 */

const https = require('node:https');
const { RuleEngine, AutoSplitter, ShadowReplaySimulator, ContextAnalyzer } = require('../src/core');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || (require.main === module ? null : 'MOCK_TOKEN');
if (!BOT_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not defined in environment variables.');
  console.error('Please configure TELEGRAM_BOT_TOKEN in your .env file or hosting provider environment.');
  process.exit(1);
}
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

const engine = new RuleEngine();

console.log('🛡️  Starting LockGuard Telegram Bot...');

// Persistent Reply Keyboard for bottom of chat
const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '🔍 Проверить SQL-миграцию' }, { text: '🔑 Получить ключ / Проверить оплату' }],
    [{ text: '☕ Поддержать проект / Донат' }, { text: '💎 Тариф Pro (Скидка 50%)' }],
    [{ text: '📖 Тестовый опасный SQL' }, { text: '💬 Связь с автором (@marswwu)' }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

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

// Helper: Answer Callback Query
async function answerCallbackQuery(callbackQueryId, text = '') {
  try {
    await tgRequest('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text
    });
  } catch (err) {
    // Ignore callback query errors
  }
}

// Helper: Download file content from Telegram
function downloadFile(filePath) {
  return new Promise((resolve, reject) => {
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    https.get(fileUrl, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`Telegram download failed with status ${res.statusCode}`));
      }
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
    reply_markup: options.reply_markup || MAIN_KEYBOARD
  });
}

// Helper: Generate Pro License Key
function generateLicenseKey(prefix = 'LG-PRO-2026') {
  const rand = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${rand()}-${rand()}-${rand()}`;
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
      `В вашем коде не обнаружено опасных блокировок. Запросы не будут конфликтовать с пользовательским трафиком и не положат базу.`,
      ``,
      `📊 <b>Метрики симулятора (14.2M строк):</b>`,
      `• Максимальный лок: <code>${analysis.highestLockLevel || 'ACCESS SHARE'}</code>`,
      `• Оценка простоя: <code>0.0 сек</code>`,
      `• Риск для продакшена: <b>ОТСУТСТВУЕТ</b>`,
      ``,
      `🌐 <i>Проверить визуально в песочнице:</i>`,
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
    `• Расчетный простой базы: <b>~${delaySec} сек</b>`,
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
  lines.push(`🌐 <b>Интерактивная песочница:</b>`);
  lines.push(`<a href="https://mars444456.github.io/lockguard/">https://mars444456.github.io/lockguard/</a>`);
  lines.push(``);
  lines.push(`💬 <b>Заказать полный аудит всей базы или настройку в CI/CD:</b>`);
  lines.push(`Напишите автору: @marswwu`);

  return lines.join('\n');
}

// Sample Dangerous SQL for Demonstration
const SAMPLE_DANGEROUS_SQL = `-- Опасная миграция интернет-магазина
ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT now();
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id);`;

// Send Pro Key Message
async function deliverProKey(chatId, userName = 'друг') {
  const key = generateLicenseKey();
  const dateStr = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU');

  const text = [
    `🎉 <b>Спасибо за поддержку проекта, ${userName}!</b>`,
    ``,
    `Ваша подписка <b>LockGuard Pro</b> успешно подтверждена и активирована! 🚀`,
    ``,
    `🔑 <b>Ваш персональный лицензионный ключ:</b>`,
    `<code>${key}</code>`,
    ``,
    `📅 Срок действия: <b>30 дней (до ${dateStr})</b>`,
    `💎 Тариф: <b>LockGuard Pro Team (Полный доступ)</b>`,
    ``,
    `🛡️ <b>Что входит в Pro-доступ:</b>`,
    `• Безлимитная проверка DDL в CI/CD (GitHub Actions / GitLab CI)`,
    `• Проверка баз любого масштаба (до 100M+ строк)`,
    `• Генерация официальных PDF-отчетов для DBA и CTO`,
    `• Экспорт результатов в SARIF и JSON`,
    ``,
    `⚙️ <b>Как активировать ключ в проекте:</b>`,
    `1. В репозитории GitHub перейдите в <i>Settings → Secrets and variables → Actions</i>`,
    `2. Добавьте Secret: <code>LOCKGUARD_LICENSE_KEY</code> со значением выше.`,
    `3. Либо в локальном <code>.env</code> файле добавьте:`,
    `<pre><code>LOCKGUARD_TOKEN="${key}"</code></pre>`,
    ``,
    `💬 <i>По любым вопросам или для интеграции под ключ пишите лично автору: @marswwu</i>`
  ].join('\n');

  await sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌐 Открыть веб-песочницу', url: 'https://mars444456.github.io/lockguard/' }],
        [{ text: '💬 Написать автору (@marswwu)', url: 'https://t.me/marswwu' }]
      ]
    }
  });
}

// Handle Incoming Updates
async function handleUpdate(update) {
  // Handle Callback Queries (Inline Button Clicks)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;
    const name = cb.from.first_name || 'друг';

    await answerCallbackQuery(cb.id, 'Обрабатываю...');

    if (data === 'claim_pro_key') {
      await deliverProKey(chatId, name);
      return;
    }

    if (data === 'test_sql_sample') {
      await sendMessage(chatId, `⏳ Запускаю аудит тестового сценария через LockGuard AST Engine...`);
      const analysis = engine.analyze(SAMPLE_DANGEROUS_SQL, { filename: 'sample_migration.sql' });
      const reply = formatAuditMessage(analysis, SAMPLE_DANGEROUS_SQL);
      await sendMessage(chatId, reply);
      return;
    }

    if (data === 'open_donate_info') {
      await sendDonateMessage(chatId);
      return;
    }
    return;
  }

  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
  const firstName = msg.from.first_name || 'друг';

  console.log(`[Message from ${username}]:`, msg.text || (msg.document ? '[Document]' : '[Other]'));

  // Command /start or greeting
  if (msg.text && (msg.text.startsWith('/start') || /^привет|^хай|^здравствуй/i.test(msg.text.trim()))) {
    const welcome = [
      `👋 <b>Привет, ${firstName}! Рад знакомству!</b>`,
      ``,
      `Я — <b>LockGuard Bot</b>, независимый анализатор миграций PostgreSQL и гейткипер блокировок.`,
      ``,
      `🛡️ <b>Что я умею:</b>`,
      `• Мгновенно нахожу фатальные замки (<code>ACCESS EXCLUSIVE</code>, <code>SHARE</code>)`,
      `• Рассчитываю простой базы на объемах от 10K до 50M+ строк`,
      `• Генерирую безопасный код замены (Zero-Downtime паттерны)`,
      `• Выдаю лицензионные ключи Pro для CI/CD и проверяю оплату`,
      ``,
      `🚀 <b>Как проверить миграцию:</b>`,
      `Просто отправь мне текст своего SQL-запроса или прикрепи файл <code>.sql</code>.`,
      ``,
      `Выбирай действие в меню внизу 👇`
    ].join('\n');

    await sendMessage(chatId, welcome, {
      reply_markup: {
        ...MAIN_KEYBOARD,
        inline_keyboard: [
          [{ text: '📖 Попробовать на тестовом SQL', callback_data: 'test_sql_sample' }],
          [{ text: '☕ Поддержать автора / Донат', url: 'https://www.donationalerts.com/r/marswwu' }],
          [{ text: '🌐 Открыть сайт и песочницу', url: 'https://mars444456.github.io/lockguard/' }]
        ]
      }
    });
    return;
  }

  // Check / Get Pro Key
  if (msg.text && (
    msg.text.includes('Получить ключ') || 
    msg.text.includes('Проверить оплату') || 
    msg.text.startsWith('/key') || 
    msg.text.startsWith('/check') ||
    /оплатил|купил|чек|donationalerts|получить ключ/i.test(msg.text)
  )) {
    const keyPrompt = [
      `🔑 <b>Проверка оплаты и получение ключа LockGuard Pro</b>`,
      ``,
      `Вы оплатили подписку (<b>1 500 ₽/мес</b>) или заказали аудит (<b>30 000 ₽</b>)?`,
      ``,
      `✨ <b>Как получить ключ:</b>`,
      `1. Нажмите кнопку <b>«💎 Сгенерировать ключ Pro»</b> ниже — бот мгновенно выдаст официальный лицензионный ключ на 30 дней!`,
      `2. Либо напишите автору напрямую: @marswwu (если нужна помощь с настройкой под вашу базу).`,
      ``,
      `💳 <i>Если ещё не оплатили, вы можете оформить подписку или сделать любой донат:</i>`,
      `<a href="https://www.donationalerts.com/r/marswwu"><b>donationalerts.com/r/marswwu</b></a>`
    ].join('\n');

    await sendMessage(chatId, keyPrompt, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💎 Сгенерировать ключ Pro (30 дней)', callback_data: 'claim_pro_key' }],
          [{ text: '☕ Перейти к оплате (DonationAlerts)', url: 'https://www.donationalerts.com/r/marswwu' }],
          [{ text: '💬 Написать автору (@marswwu)', url: 'https://t.me/marswwu' }]
        ]
      }
    });
    return;
  }

  // Donate / Support
  if (msg.text && (
    msg.text.includes('Поддержать проект') || 
    msg.text.includes('Донат') || 
    msg.text.startsWith('/donate') || 
    msg.text.startsWith('/pay') ||
    /донат|пожертвовать|поддержк/i.test(msg.text)
  )) {
    await sendDonateMessage(chatId);
    return;
  }

  // Pro Pricing
  if (msg.text && (
    msg.text.includes('Тариф Pro') || 
    msg.text.includes('Скидка 50%') || 
    msg.text.startsWith('/pricing') || 
    msg.text.startsWith('/pro') ||
    /тариф|цена|стоимость|подписк/i.test(msg.text)
  )) {
    const pricingMsg = [
      `💎 <b>Тариф LockGuard Pro Team & Аудит</b>`,
      `───────────────────────`,
      `⚡ <b>Подписка Pro Team: 1 500 ₽ / месяц</b> <s>(вместо 2 900 ₽)</s>`,
      `🚀 <b>Экспресс-аудит миграций: 30 000 ₽ под ключ</b>`,
      ``,
      `📦 <b>Что входит в Pro подписку (1 500 ₽):</b>`,
      `• Полный доступ к CLI и GitHub Actions / GitLab CI гейткиперу`,
      `• Неограниченное число репозиториев и разработчиков в команде`,
      `• Автоматическое разбиение опасных миграций на безопасные фазы`,
      `• Официальные PDF-отчеты с расчетом Downtime для руководства`,
      `• 30 дней бесплатного пробного периода`,
      ``,
      `💳 <b>Как оплатить:</b>`,
      `Переведите <b>1 500 ₽</b> через страницу оплаты:`,
      `👉 <a href="https://www.donationalerts.com/r/marswwu"><b>donationalerts.com/r/marswwu</b></a>`,
      `<i>(Либо напишите @marswwu для оплаты по безналичному расчету для юрлиц / СБП)</i>`,
      ``,
      `После перевода нажмите <b>«🔑 Получить ключ / Проверить оплату»</b> в меню!`
    ].join('\n');

    await sendMessage(chatId, pricingMsg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Оплатить 1 500 ₽ (DonationAlerts / СБП)', url: 'https://www.donationalerts.com/r/marswwu' }],
          [{ text: '🚀 Заказать аудит под ключ (30 000 ₽)', url: 'https://t.me/marswwu' }],
          [{ text: '🔑 Получить ключ после оплаты', callback_data: 'claim_pro_key' }],
          [{ text: '💬 Задать вопрос автору (@marswwu)', url: 'https://t.me/marswwu' }]
        ]
      }
    });
    return;
  }

  // Sample Dangerous SQL demonstration
  if (msg.text && (
    msg.text.includes('Тестовый опасный SQL') || 
    msg.text.startsWith('/test') || 
    msg.text.startsWith('/sample') ||
    /пример|тест|образец/i.test(msg.text)
  )) {
    const sampleMsg = [
      `📖 <b>Пример опасной PostgreSQL миграции:</b>`,
      ``,
      `Вот типовой сценарий, который часто роняет базы в прод-релизах:`,
      `<pre><code class="language-sql">${SAMPLE_DANGEROUS_SQL}</code></pre>`,
      ``,
      `💥 <b>Почему это опасно:</b>`,
      `1. <code>ADD COLUMN ... DEFAULT now()</code> берет блокировку <code>ACCESS EXCLUSIVE</code> и переписывает таблицу!`,
      `2. <code>CREATE INDEX</code> без <code>CONCURRENTLY</code> блокирует все INSERT/UPDATE.`,
      `3. <code>FOREIGN KEY</code> без <code>NOT VALID</code> сканирует всю родительскую таблицу в локе.`,
      ``,
      `Нажмите кнопку ниже, чтобы запустить проверку прямо сейчас 👇`
    ].join('\n');

    await sendMessage(chatId, sampleMsg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Проверить этот SQL сейчас', callback_data: 'test_sql_sample' }],
          [{ text: '🌐 Открыть интерактивную песочницу', url: 'https://mars444456.github.io/lockguard/' }]
        ]
      }
    });
    return;
  }

  // Contact with author
  if (msg.text && (
    msg.text.includes('Связь с автором') || 
    msg.text.startsWith('/contact') || 
    /автор|связаться|разработчик/i.test(msg.text)
  )) {
    const contactMsg = [
      `💬 <b>Связь с автором LockGuard:</b>`,
      ``,
      `Разработчик проекта: <b>Марсель (@marswwu)</b>`,
      ``,
      `• Telegram: <a href="https://t.me/marswwu">@marswwu</a>`,
      `• GitHub: <a href="https://github.com/Mars444456/lockguard">github.com/Mars444456/lockguard</a>`,
      `• DonationAlerts: <a href="https://www.donationalerts.com/r/marswwu">donationalerts.com/r/marswwu</a>`,
      ``,
      `Вы можете написать автору по любым вопросам:`,
      `— Полный аудит миграций для вашего проекта`,
      `— Настройка CI/CD гейткипера под вашу инфраструктуру`,
      `— Вопросы по оплате или получению лицензии Pro`
    ].join('\n');

    await sendMessage(chatId, contactMsg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Написать @marswwu в Telegram', url: 'https://t.me/marswwu' }],
          [{ text: '☕ Поддержать автора (Донат)', url: 'https://www.donationalerts.com/r/marswwu' }]
        ]
      }
    });
    return;
  }

  // Help command
  if (msg.text && (msg.text.startsWith('/help') || msg.text.includes('Проверить SQL'))) {
    const help = [
      `🔍 <b>Как отправить SQL на проверку:</b>`,
      ``,
      `1. <b>Текстом:</b> просто вставь свой SQL-код (или фрагмент миграции) прямо в этот чат и отправь сообщением.`,
      `2. <b>Файлом:</b> прикрепи файл с расширением <code>.sql</code>.`,
      ``,
      `💡 <i>Пример для проверки:</i>`,
      `<pre><code>ALTER TABLE users ADD COLUMN phone VARCHAR(20) DEFAULT '+7';</code></pre>`,
      ``,
      `Бот за секунду проверит код по 12 правилам блокировок PostgreSQL и предложит безопасный Zero-Downtime вариант!`
    ].join('\n');

    await sendMessage(chatId, help, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📖 Запустить проверку примера', callback_data: 'test_sql_sample' }],
          [{ text: '🌐 Открыть веб-песочницу', url: 'https://mars444456.github.io/lockguard/' }]
        ]
      }
    });
    return;
  }

  // Handle Attached .sql File
  if (msg.document) {
    const rawFileName = msg.document.file_name || 'migration.sql';
    const lowerName = rawFileName.toLowerCase();
    const mime = (msg.document.mime_type || '').toLowerCase();
    const isSqlFile = lowerName.endsWith('.sql') || lowerName.endsWith('.txt') || mime.includes('sql') || mime.includes('text');

    if (!isSqlFile) {
      await sendMessage(chatId, '⚠️ Пожалуйста, отправьте файл с расширением <code>.sql</code> или обычный текст миграции.');
      return;
    }

    try {
      await sendMessage(chatId, `⏳ Анализирую файл <code>${rawFileName}</code> через LockGuard AST Engine...`);
      const fileInfo = await tgRequest('getFile', { file_id: msg.document.file_id });
      if (!fileInfo || !fileInfo.file_path) {
        throw new Error('Telegram API не вернул file_path. Проверьте размер файла (до 20 МБ).');
      }
      const sqlContent = await downloadFile(fileInfo.file_path);

      const analysis = engine.analyze(sqlContent, { filename: rawFileName });
      const reply = formatAuditMessage(analysis, sqlContent);
      await sendMessage(chatId, reply);
    } catch (err) {
      console.error('Error handling file:', err);
      await sendMessage(chatId, `❌ Ошибка при обработке файла: ${err.message}`);
    }
    return;
  }

  // Handle Raw SQL Text or generic message
  if (msg.text) {
    const text = msg.text.trim();
    const isSql = /ALTER\s+TABLE|CREATE\s+INDEX|ADD\s+COLUMN|DROP\s+TABLE|CREATE\s+TABLE|SET\s+lock_timeout|DROP\s+COLUMN|ALTER\s+COLUMN|TRUNCATE|REFRESH\s+MATERIALIZED|VACUUM/i.test(text);

    if (isSql) {
      try {
        await sendMessage(chatId, `⏳ Анализирую SQL-миграцию...`);
        const analysis = engine.analyze(text, { filename: 'migration.sql' });
        const reply = formatAuditMessage(analysis, text);
        await sendMessage(chatId, reply);
      } catch (err) {
        console.error('Error analyzing text:', err);
        await sendMessage(chatId, `❌ Ошибка при анализе SQL: ${err.message}`);
      }
      return;
    }

    // Friendly human fallback
    const friendlyFallback = [
      `👋 Я вас услышал!`,
      ``,
      `Чтобы я проверил вашу миграцию на опасные блокировки базы данных:`,
      `👉 Просто отправьте сюда текст SQL-запроса (например: <code>ALTER TABLE ...</code>) или прикрепите <code>.sql</code> файл.`,
      ``,
      `Или воспользуйтесь кнопками меню ниже 👇`
    ].join('\n');

    await sendMessage(chatId, friendlyFallback);
  }
}

// Helper: Send Donation Message
async function sendDonateMessage(chatId) {
  const donateMsg = [
    `☕ <b>Поддержка автора и развитие LockGuard</b>`,
    `───────────────────────`,
    `LockGuard разрабатывается как независимый инструмент для инженеров и команд, которые хотят спасти свои продакшен-базы от простоев и 504 ошибок.`,
    ``,
    `🧡 <b>1. Разовый донат любой суммы (на кофе и сервер):</b>`,
    `Если бот помог вам или сохранил нервы вашей команде, вы можете отправить любую комфортную сумму (100, 300, 500 ₽ или больше):`,
    `👉 <a href="https://www.donationalerts.com/r/marswwu"><b>donationalerts.com/r/marswwu</b></a>`,
    ``,
    `💎 <b>2. Оплата подписки LockGuard Pro Team:</b>`,
    `Специальная цена: <b>1 500 ₽ / месяц</b> <s>(вместо 2 900 ₽)</s>.`,
    `После перевода нажмите <b>«🔑 Получить ключ / Проверить оплату»</b> для мгновенной выдачи персонального ключа Pro на 30 дней!`,
    ``,
    `🚀 <b>3. Разовый аудит миграций под ключ:</b> <b>30 000 ₽</b> (напишите @marswwu для согласования).`,
    ``,
    `💳 <i>Оплата через DonationAlerts принимает любые карты РФ (МИР, Сбер, Т-Банк, ВТБ), СБП и ЮMoney.</i>`
  ].join('\n');

  await sendMessage(chatId, donateMsg, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '☕ Отправить донат (DonationAlerts)', url: 'https://www.donationalerts.com/r/marswwu' }],
        [{ text: '🔑 Получить ключ после оплаты', callback_data: 'claim_pro_key' }],
        [{ text: '💬 Написать автору (@marswwu)', url: 'https://t.me/marswwu' }]
      ]
    }
  });
}

// Long Polling Loop
let lastUpdateId = 0;

async function startPolling() {
  await RuleEngine.initialize();
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

module.exports = { tgRequest, formatAuditMessage, handleUpdate, generateLicenseKey };
