<div align="center">

# 🛡️ LockGuard

Анализатор SQL-миграций PostgreSQL: находит известные риски блокировок до запуска миграции, формирует отчёты для CI и черновики поэтапных изменений.

[![GitHub Action](https://img.shields.io/badge/GitHub_Action-Setup-181717?style=for-the-badge&logo=github)](#github-action)
[![Web Playground](https://img.shields.io/badge/Web_Playground-Open-7c3aed?style=for-the-badge&logo=googlechrome&logoColor=white)](https://mars444456.github.io/lockguard/)
[![Telegram Audit Bot](https://img.shields.io/badge/Telegram_Bot-@lockguard__audit__bot-0088cc?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/lockguard_audit_bot)
[![CI](https://github.com/Mars444456/lockguard/actions/workflows/lockguard.yml/badge.svg?branch=main)](https://github.com/Mars444456/lockguard/actions/workflows/lockguard.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-10B981?style=for-the-badge)](LICENSE)

**Быстрый доступ:** [🚀 Запуск](#быстрый-запуск) · [🌐 Демо](https://mars444456.github.io/lockguard/) · [🤖 Бот](https://t.me/lockguard_audit_bot) · [📜 Правила](#каталог-правил) · [🖥️ CLI](#локальный-cli) · [💳 Тарифы](#услуги-и-оплата) · [📬 Контакты](#контакты-и-реквизиты-исполнителя)

</div>

[Сайт и демонстрация](https://mars444456.github.io/lockguard/) · [Контакты](https://mars444456.github.io/lockguard/contacts.html) · [Оферта и возвраты](https://mars444456.github.io/lockguard/offer.html) · [Конфиденциальность](https://mars444456.github.io/lockguard/privacy.html)

Текущая версия кода — **1.1.0**. Ядро, CLI и GitHub Action доступны по лицензии [MIT](LICENSE). Платные услуги описаны отдельно ниже.

## Возможности

- Разбор синтаксиса PostgreSQL через `libpg-query` 18.1.5 (WASM).
- 12 правил для индексов, внешних ключей, изменений типов, `NOT NULL`, таймаутов и других операций.
- CLI: проверка файлов и каталогов, изменённых файлов и содержимого индекса Git перед коммитом.
- Отчёты в терминале, JSON, Markdown и SARIF.
- Черновики многофазных миграций и ограниченное автоисправление `CREATE INDEX` и таймаутов.
- Локальный HTTP dashboard, браузерная демонстрация и код Telegram-бота.
- GitHub webhook с проверкой подписи и анализом SQL из PR; публикация commit status включается отдельно.
- Серверная интеграция Robokassa с тестовым режимом, проверкой ResultURL и защитой от повторной обработки платежа.

**Проверка не гарантирует отсутствие простоев.** Парсер проверяет синтаксис, а правила покрывают часть операций PostgreSQL. Неподдерживаемые конструкции получают `LG-000` и `analysisComplete: false`, требуя ручной проверки. Оценки времени и нагрузки — модель, а не измерения на вашей базе.

## Быстрый запуск

Требуется Node.js с npm. В `package.json` указан минимум Node.js 18; локальная проверка выполнена на Node.js 24.12.0, CI использует Node.js 24.

```sh
git clone https://github.com/Mars444456/lockguard.git
cd lockguard
npm ci --ignore-scripts
node bin/lockguard.js check fixtures/10_safe_migration.sql
node bin/lockguard.js rules
npm test
```

## Локальный CLI

Проверка собственных миграций:

```sh
node bin/lockguard.js check ./migrations
node bin/lockguard.js check ./migrations --strict --format=json
node bin/lockguard.js check ./migrations --format=sarif --output=lockguard.sarif
node bin/lockguard.js check --changed origin/main
node bin/lockguard.js check --staged
```

Коды завершения: **0** — нет нарушений выбранного порога; **1** — найдены нарушения; **2** — ошибка запуска, чтения или анализа. `--strict` также блокирует предупреждения. Не считайте любой ненулевой код успешной работой анализатора.

`--staged` читает SQL из индекса Git, включая частично добавленные файлы. Этот режим нельзя совмещать с `--fix`: исправьте рабочие файлы, проверьте diff и добавьте их заново.

## Каталог правил

| Правило | Что проверяет |
|---|---|
| LG-001 | Добавление колонки с volatile или нетривиальным DEFAULT |
| LG-002 | Построение индекса без CONCURRENTLY |
| LG-003 | Добавление внешнего ключа без NOT VALID |
| LG-004 | Смена типа колонки с риском перезаписи таблицы |
| LG-005 | Прямое добавление UNIQUE без конкурентного построения индекса |
| LG-006 | Немедленное удаление колонки или таблицы |
| LG-007 | VACUUM и изменение параметров autovacuum в транзакции |
| LG-008 | Отсутствующий или неэффективный lock_timeout перед DDL |
| LG-009 | SET NOT NULL без предварительно проверенного ограничения |
| LG-010 | CONCURRENTLY внутри транзакционного блока |
| LG-011 | Внешний ключ без подтверждённого индекса на дочерних колонках |
| LG-012 | TRUNCATE и REFRESH MATERIALIZED VIEW без CONCURRENTLY |

Отдельное нарушение `LG-000` означает неполный анализ и необходимость ручной проверки. Исходный код проверок находится в [src/core/rules](src/core/rules/), полный вывод доступен через `node bin/lockguard.js rules`.

## GitHub Action

Добавьте в свой репозиторий `.github/workflows/lockguard.yml`:

```yaml
name: PostgreSQL migration audit
on:
  pull_request:
    paths:
      - 'migrations/**'
      - '.github/workflows/lockguard.yml'

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: Mars444456/lockguard@main
        with:
          migrations_dir: ./migrations
          severity: HIGH
          format: github-pr-comment
          output_file: lockguard-report.md
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: lockguard-report
          path: lockguard-report.md
          if-no-files-found: ignore
```

Action проверяет указанный каталог и сохраняет отчёт; комментарий в PR сам по себе не публикуется. Для воспроизводимости можно закрепить проверенный SHA коммита вместо `main`.

CI этого проекта запускает тесты, проверяет соответствие браузерной сборки исходникам и анализирует SQL, изменённый в PR относительно его базового коммита. Учебные SQL в `fixtures/` и `test/` проверяются тестами и исключены из аудита реальных миграций.

## Пример риска и черновики исправлений

```sql
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

На существующей таблице правило `LG-002` предупреждает о блокировке записи при обычном построении индекса. Вариант для ручной проверки:

```sql
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders(user_id);
RESET lock_timeout;
```

`CREATE INDEX CONCURRENTLY` нельзя запускать внутри транзакционного блока; применимость также зависит от таблицы, схемы и вашего migration runner.

```sh
node bin/lockguard.js split ./migrations/001.sql --write --out-dir=./migration-drafts
node bin/lockguard.js check ./migrations/001.sql --fix
```

Результаты `split` — **черновики для проверки**, не готовая замена исходной миграции. Сверьте все исходные операции, перенос данных, ограничения, порядок релизов и откат. Шаблоны backfill требуют ограничения размера пакетов и проверки на тестовой базе. `--fix` меняет исходный файл, поэтому перед запуском сохраните его в Git и просмотрите diff после изменения.

## Локальный dashboard и API

```sh
npm start
```

Откройте [http://localhost:3000](http://localhost:3000). Не открывайте `src/ui/index.html` через `file://`: интерфейсу нужен сервер API.

Скопируйте `.env.example` в `.env` и задайте `LOCKGUARD_ADMIN_TOKEN` — случайный секрет администратора. Он нужен для управления ключами, организацией, историей и платежами. Без него административные API возвращают 503. В интерфейсе используйте Admin sign in; токен хранится в памяти вкладки.

Исходный SQL для анализа передаётся серверу локального dashboard. Статическая демонстрация на GitHub Pages выполняет анализ в браузере. **GitHub Pages не запускает Node.js API и не принимает платёжные уведомления.**

По умолчанию данные сервера сохраняются в JSON в `data/`. Приложение рассчитано на **одну организацию и один процесс записи**. Клиентская регистрация, изоляция нескольких организаций, полноценная проверка лицензий и промышленная база данных пока не реализованы.

## Услуги и оплата

| Предложение | Стоимость | Условия |
|---|---:|---|
| Community | Бесплатно | Открытое ядро, локальный CLI и браузерная демонстрация |
| LockGuard Pro | 1 500 ₽ / 30 дней | Доступ к согласованному размещённому экземпляру и поддержка по использованию; адрес и возможности подтверждаются до оплаты |
| Аудит SQL-миграций PostgreSQL | 30 000 ₽ / разовый заказ | Объём, материалы и срок согласуются письменно до оплаты; результат — электронный отчёт и рекомендации |

Продление Pro выполняется отдельным платежом, без автоматических списаний. Покупка аудита создаёт заказ на услугу и не включает Pro автоматически.

**Онлайн-оплата через Robokassa находится на этапе подключения.** Код интеграции готов для тестирования, но наличие кода не означает, что магазин активирован или реальные платежи уже работают. До оплаты согласуйте заказ по [email](mailto:minsafinmarsel02@gmail.com).

Для запуска оплаты нужен отдельный доступный по HTTPS сервер с настроенными секретами Robokassa, ResultURL и сервисом чеков для самозанятого. Пароли задаются только в окружении сервера. Тестовый платёж не выдаёт рабочий доступ; переход на SuccessURL также не подтверждает оплату.

Возвраты оформляются через поддержку и кабинет провайдера; автоматическая синхронизация возвратов и отзыв доступа пока не реализованы. Генератор B2B-счёта выдаёт только образец без банковских реквизитов, который нельзя использовать для перевода денег.

Подробности: [настройка оплаты](reports/RF-PAYMENTS-SETUP.md), [подключение интеграций](reports/INTEGRATIONS-SETUP.md), [публичная оферта и возвраты](https://mars444456.github.io/lockguard/offer.html).

## Контакты и реквизиты исполнителя

**Минсафин Марсель Ренатович** — самозанятый, плательщик налога на профессиональный доход.

**ИНН:** 631112758865.

**Email:** [minsafinmarsel02@gmail.com](mailto:minsafinmarsel02@gmail.com).

**Telegram:** [@marswwu](https://t.me/marswwu).

Заказы, вопросы по доступу и обращения о возврате принимаются по email. Контакты и документы доступны также [на сайте](https://mars444456.github.io/lockguard/contacts.html).

## Разработка

```sh
npm test
npm run build:browser
npm run build:legal
```

- `src/core/` — парсер, правила, отчёты и генерация черновиков.
- `src/cli/`, `bin/` — CLI, Git hook и Telegram-бот.
- `src/server/`, `src/ui/` — сервер и локальный dashboard.
- `docs/` — статический сайт GitHub Pages и собранный браузерный анализатор.
- `config/seller.json` — публичные реквизиты для генерации юридических страниц.
- `test/` — тесты правил, CLI, HTTP, хранения, интеграций и SQL через PGlite.

После изменения ядра выполните `npm run build:browser` и включите в коммит `docs/lockguard-engine.js` вместе с `docs/libpg-query.wasm`. После изменения реквизитов выполните `npm run build:legal`.

Отчёты об аудите: [первый этап](reports/QA-AUDIT-2026-10-30.md), [второй этап](reports/QA-STAGE2-2026-10-30.md), [третий этап](reports/QA-STAGE3-2026-10-30.md), [Git, CI и документация](reports/QA-STAGE4-2026-10-30.md). Они описывают объём проведённых проверок и оставшиеся ограничения.
