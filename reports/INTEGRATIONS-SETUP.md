# Настройка PostgreSQL-парсера, GitHub и российской оплаты

Актуализация от 31 октября 2026: аккаунты и разделение данных организаций теперь реализованы; см. [настройку аккаунтов и SQLite](ACCOUNTS-STORAGE-SETUP.md). Ограничение одного оператора ниже относится к интеграции GitHub webhook.

## Установка и проверки

Требуется Node.js 24+. В PowerShell используйте `npm.cmd`, если политика выполнения блокирует npm.ps1:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build:browser
npm.cmd test
```

`libpg-query` — runtime-зависимость; интеграция Robokassa использует стандартный node:crypto. PGlite и esbuild — зависимости разработки. Версии закреплены в package-lock.json. GitHub Action и Docker устанавливают runtime через npm ci.

Для программного использования перед синхронным анализом один раз дождитесь загрузки WASM:

```js
const { RuleEngine } = require('./src/core');
await RuleEngine.initialize();
const result = new RuleEngine().analyze(sql);
```

CLI, сервер и Telegram polling делают это самостоятельно. Статический playground ждёт `window.LockGuard.ready`. При публикации docs нужно включить **оба** файла: lockguard-engine.js и libpg-query.wasm, с MIME application/wasm для WASM. Открывайте страницу через HTTP(S).

## GitHub

Настройте в окружении сервера:

```dotenv
GITHUB_WEBHOOK_SECRET=<случайный секрет>
GITHUB_TOKEN=<токен с доступом к нужным репозиториям>
GITHUB_REPOSITORIES=owner/repository
GITHUB_PUBLISH_STATUS=false
```

Создайте webhook для событий Pull requests, Content type application/json, URL `https://YOUR_HOST/api/v1/github/webhook`. Укажите тот же секрет. Поддержаны opened, reopened, synchronize и ready_for_review; ping проверяет подключение. GitHub webhook авторизуется собственной подписью, токен администратора ему не нужен.

Нужны разрешения Contents: read и Pull requests: read. Чтобы публиковать commit status `lockguard`, выдайте Commit statuses: write и установите `GITHUB_PUBLISH_STATUS=true`. Отчёт Markdown также возвращается в ответе; комментарии в PR обработчик не отправляет. При необходимости добавьте статус lockguard в branch protection.

Обработчик получает текущий PR, полный список файлов и SQL по blob SHA через фиксированный api.github.com. Событие для устаревшего head отклоняется; SHA повторно проверяется перед завершением. Проверяются добавленные/изменённые/переименованные .sql; удалённые пропускаются. Ограничения: 300 изменённых файлов, 512 KiB на SQL-файл и 2 MiB SQL суммарно. При превышении, обрезанном списке и ошибках API успешный статус не публикуется.

Обработка выполняется синхронно. Для крупных PR до production нужен фоновый worker: GitHub может повторить webhook при превышении времени ожидания. Повторная обработка безопасно пересчитывает статус того же SHA, но отдельная очередь и постоянный реестр delivery ещё не реализованы. Это конфигурация для одного доверенного сервера/организации; автоматическая установка GitHub App для нескольких клиентов не реализована.

## Российская оплата

Stripe заменён на Robokassa для самозанятого. Актуальные настройки и сценарий оплаты описаны в [инструкции Robokassa](RF-PAYMENTS-SETUP.md).

## Что проверено в PostgreSQL

Тесты запускают PostgreSQL в WebAssembly через PGlite с отдельной БД в памяти. Выполняются SQL безопасного fixture и выбранные фазы генератора; проверяются данные, тип UUID, default, NOT NULL, валидация FK, уникальность и ON DELETE CASCADE. Фазы с CONCURRENTLY выполняются **по одной SQL-команде в autocommit**, без внешнего BEGIN.

Эти тесты проверяют выполнение и свойства схемы. Межпроцессные блокировки, нагрузка и поведение нескольких соединений требуют отдельного PostgreSQL-сервера; PGlite здесь их не моделирует. AutoSplitter остаётся черновым помощником и не гарантирует перенос всех неотмеченных операций исходной миграции.

## Источники реализации

- [libpg-query — PostgreSQL parser](https://github.com/constructive-io/libpg-query-node)
- [PGlite — установка и выполнение SQL](https://pglite.dev/docs/)
- [GitHub — проверка подписи webhook](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [GitHub — Git blobs API](https://docs.github.com/en/rest/git/blobs)
- [Robokassa — уведомления](https://docs.robokassa.ru/ru/notifications-and-redirects)
