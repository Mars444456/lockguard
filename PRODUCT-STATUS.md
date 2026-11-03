# Product status / Состояние продукта

The backup scheduler preserves the deadline across restarts, bounds long waits to Node timer limits and retries immediately on startup when backup evidence is missing, overdue, invalid, future-dated or failed. Attempts run one at a time; retries wait the configured interval after completion. Stopping prevents re-arming after a pending copy finishes. Seven simulated-clock regressions cover scheduling, failure and shutdown.

Version 1.5.2 adds owner-visible backup attempt, success and failure diagnostics. A verified retry clears the active failure; failed, overdue or future-dated evidence cannot establish operational readiness. Scheduler errors contain no original exception text. External monitoring and off-host storage remain operator setup tasks.

## 1.5.0: verified email and browser journeys

Version 1.5.1 adds a synthetic regression corpus across all twelve rules. Timeout rollback, chained transactions and runner-wrapped VACUUM are tracked explicitly. NOT NULL checks use the selected target PostgreSQL version and do not retain rolled-back validation evidence. PostgreSQL 10–11 enforcement requires manual planning. ONLY DDL requires manual analysis rather than a recursive rewrite. Reordered leading btree keys can supply composite foreign-key index evidence. See [TESTING.md](TESTING.md).

LockGuard provides static PostgreSQL migration checks, CI reports, reviewable draft plans, and a server workspace with organization-scoped history, API keys, schema snapshots and team reviews. The public browser analyzer processes SQL locally. The Telegram bot processes submitted SQL on its host and does not activate licenses or confirm payments.

The uncalibrated duration, traffic, outage and financial-loss models have been removed. `simulate` and `/api/v1/simulate` no longer return numerical forecasts. Metadata enrichment accepts supplied or queried table statistics; unknown values remain unknown. No SQL is executed by the analyzer.

Checks expose `coverageComplete` and a `coverage` record of disabled rules and suppressed findings. Excluded checks cannot produce phased drafts or newly approved team reviews. Old runs without a coverage record must be checked again before creating a review. Inputs are limited to 512 KB and 1000 SQL statements per file. Unknown/custom SQL semantics require manual review (`LG-000`); function volatility cannot be inferred from arbitrary function names.

Drafts preserve supported index, foreign-key and UNIQUE options. They do not generate destructive substitutes for DROP or TRUNCATE. Concurrent statements must be executed individually on the same connection outside an explicit or runner-created transaction. ORM snippets need integration into the actual revision/dependency chain; they are not an automatically verified release procedure.

Index inspection requires actual diagnostic input (`lockguard watchdog diagnostic-rows.json`) or `DATABASE_URL` with `psql` available (`lockguard watchdog`). `/api/v1/watchdog` returns the diagnostic query; POST accepts `{ "rows": [...] }`. An empty supplied report does not prove overall database health. Invalid indexes do not establish the cause of failure; DROP INDEX is not proposed automatically.

GitHub webhooks require a valid signature and configured repository allowlist. Only SQL blobs from the actual PR are analyzed. The former synthetic PR-history endpoint has been removed. An incomplete audit publishes an error status when status publishing is enabled. A PR without SQL files is identified as such.

Email ownership is now recorded server-side. Creating or accepting invitations requires a verified inviter/invitee; old unverified sessions cannot retain access to another organization. Verification links are account-bound, expire after 30 minutes, are stored hashed and require explicit confirmation in the matching signed-in account. GET does not consume them. Password changes revoke pending links. Email recovery also verifies ownership; offline recovery does not. Missing mail configuration is reported explicitly and does not disable ordinary SQL analysis.

Automated Chromium tests exercise registration, verification, schema-aware analysis, invitations, independent team review and email recovery. Their separate loopback mail receiver and Pro setup control use disposable test accounts and are not product API endpoints. No live mail is sent by tests.

## Public hosting and commercial readiness

The public GitHub Pages analyzer is available without registration. The Render Free account workspace remains a **test environment with temporary storage**. It is not suitable for persistent customer records. Production hosting with durable storage, off-host encrypted backups and a successful restore drill is still required for a permanent paid workspace. Email recovery requires a configured mail provider; offline recovery codes are available. Merchant activation and production payment acceptance must be completed separately. A donation never activates Pro.

These infrastructure dependencies are not reported as completed by the application. See [OPERATIONS.md](OPERATIONS.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Русский

Планировщик сохраняет срок резервирования после перезапуска и корректно обрабатывает большие интервалы. Отсутствующая, просроченная, некорректная или будущая дата и прошлый сбой вызывают попытку при запуске. Попытки не пересекаются; следующая назначается через заданный интервал после завершения текущей. Семь тестов с управляемыми часами проверяют расписание, ошибки и остановку.

В версии 1.5.1 добавлен синтетический корпус для всех 12 правил. Исправлены границы транзакций и таймаутов, учёт версии PostgreSQL и отката проверки NOT NULL, а также распознавание составных индексов FK. Для ONLY и неподдерживаемой версии оптимизации требуется ручная проверка; черновик не меняет область действия исходной команды.

В версии 1.4.1 убраны неподтверждённые числовые прогнозы, фиктивная выдача ключей ботом и запись вымышленных PR в историю. Исправлены планы миграций, учёт версии PostgreSQL и границ транзакций. Отключённые правила и подавленные замечания видны в результате; для таких проверок не выдаётся план и не создаётся командное ревью. Старые проверки без сведений о покрытии нужно выполнить заново.

Анализ SQL, отчёты и серверные функции проверяются автоматически. Это не означает, что можно считать любой SQL корректным или обещать отсутствие блокировок. Длительность и поведение под нагрузкой проверяют на репрезентативной базе.

До платного запуска постоянного публичного кабинета нужны постоянное хранилище, внешние резервные копии с проверкой восстановления и завершение подключения оплаты. Облачный кабинет Render Free остаётся учебным стендом. Почтовое восстановление требует настройки провайдера; восстановление по сохранённому коду доступно отдельно.
