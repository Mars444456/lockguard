# Product status / Состояние продукта

## 1.4.1: evidence and execution correctness

LockGuard provides static PostgreSQL migration checks, CI reports, reviewable draft plans, and a server workspace with organization-scoped history, API keys, schema snapshots and team reviews. The public browser analyzer processes SQL locally. The Telegram bot processes submitted SQL on its host and does not activate licenses or confirm payments.

The uncalibrated duration, traffic, outage and financial-loss models have been removed. `simulate` and `/api/v1/simulate` no longer return numerical forecasts. Metadata enrichment accepts supplied or queried table statistics; unknown values remain unknown. No SQL is executed by the analyzer.

Checks expose `coverageComplete` and a `coverage` record of disabled rules and suppressed findings. Excluded checks cannot produce phased drafts or newly approved team reviews. Old runs without a coverage record must be checked again before creating a review. Inputs are limited to 512 KB and 1000 SQL statements per file. Unknown/custom SQL semantics require manual review (`LG-000`); function volatility cannot be inferred from arbitrary function names.

Drafts preserve supported index, foreign-key and UNIQUE options. They do not generate destructive substitutes for DROP or TRUNCATE. Concurrent statements must be executed individually on the same connection outside an explicit or runner-created transaction. ORM snippets need integration into the actual revision/dependency chain; they are not an automatically verified release procedure.

Index inspection requires actual diagnostic input (`lockguard watchdog diagnostic-rows.json`) or `DATABASE_URL` with `psql` available (`lockguard watchdog`). `/api/v1/watchdog` returns the diagnostic query; POST accepts `{ "rows": [...] }`. An empty supplied report does not prove overall database health. Invalid indexes do not establish the cause of failure; DROP INDEX is not proposed automatically.

GitHub webhooks require a valid signature and configured repository allowlist. Only SQL blobs from the actual PR are analyzed. The former synthetic PR-history endpoint has been removed. An incomplete audit publishes an error status when status publishing is enabled. A PR without SQL files is identified as such.

## Public hosting and commercial readiness

The public GitHub Pages analyzer is available without registration. The Render Free account workspace remains a **test environment with temporary storage**. It is not suitable for persistent customer records. Production hosting with durable storage, off-host encrypted backups and a successful restore drill is still required for a permanent paid workspace. Email recovery requires a configured mail provider; offline recovery codes are available. Merchant activation and production payment acceptance must be completed separately. A donation never activates Pro.

These infrastructure dependencies are not reported as completed by the application. See [OPERATIONS.md](OPERATIONS.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Русский

В версии 1.4.1 убраны неподтверждённые числовые прогнозы, фиктивная выдача ключей ботом и запись вымышленных PR в историю. Исправлены планы миграций, учёт версии PostgreSQL и границ транзакций. Отключённые правила и подавленные замечания видны в результате; для таких проверок не выдаётся план и не создаётся командное ревью. Старые проверки без сведений о покрытии нужно выполнить заново.

Анализ SQL, отчёты и серверные функции проверяются автоматически. Это не означает, что можно считать любой SQL корректным или обещать отсутствие блокировок. Длительность и поведение под нагрузкой проверяют на репрезентативной базе.

До платного запуска постоянного публичного кабинета нужны постоянное хранилище, внешние резервные копии с проверкой восстановления и завершение подключения оплаты. Облачный кабинет Render Free остаётся учебным стендом. Почтовое восстановление требует настройки провайдера; восстановление по сохранённому коду доступно отдельно.
