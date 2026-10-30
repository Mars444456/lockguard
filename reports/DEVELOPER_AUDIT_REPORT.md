# 🛡️ LockGuard: Полный отчет аудита миграций и справочник для разработчиков

> **Назначение документа:** Сводный отчет о результатах статического анализа DDL-миграций в проекте, детальное описание всех обнаруженных блокировок таблиц (`ACCESS EXCLUSIVE`, `SHARE`), каталог правил **LG-001 – LG-010** и готовые рецепты для безопасного проведения Zero-Downtime релизов в PostgreSQL.

---

## 📑 Оглавление
1. [Сводка аудита миграций](#1-сводка-аудита-миграций)
2. [Таблица проверенных файлов и уровней блокировок](#2-таблица-проверенных-файлов-и-уровней-блокировок)
3. [Механика блокировок в PostgreSQL: почему это приводит к авариям](#3-механика-блокировок-в-postgresql-почему-это-приводит-к-авариям)
4. [Каталог правил LockGuard (Top-10 Fatal Anti-Patterns)](#4-каталог-правил-lockguard-top-10-fatal-anti-patterns)
5. [Пофайловый аудит и рецепты исправления](#5-пофайловый-аудит-и-рецепты-исправления)
6. [Памятка разработчику: инструменты и лучшие практики](#6-памятка-разработчику-инструменты-и-лучшие-практики)

---

## 1. Сводка аудита миграций

Результаты статического анализа миграций с помощью ядра LockGuard:

| Метрика | Значение |
| :--- | :--- |
| **Статус гейткипера** | 🛑 **BLOCKED (Обнаружены опасные блокировки)** |
| **Проверено файлов** | **10** файлов |
| **Всего найдено нарушений** | **20** нарушений |
| **Критических (CRITICAL)** | **12** (полная блокировка чтения и записи) |
| **Высоких (HIGH)** | **7** (блокировка параллельных операций / риски очередей) |
| **Средних (MEDIUM/WARN)** | **1** (изменение параметров autovacuum) |
| **Файлы без нарушений (Safe)** | `fixtures/10_safe_migration.sql` (100% Zero-Downtime) |

---

## 2. Таблица проверенных файлов и уровней блокировок

| Файл | Статус | Максимальный лок | Затронутые таблицы | Нарушений | Коды правил |
| :--- | :---: | :---: | :--- | :---: | :--- |
| [`01_dangerous_add_column.sql`](file:///d:/proect%20A/fixtures/01_dangerous_add_column.sql) | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `orders`, `payments` | **2** | LG-001 |
| [`02_dangerous_create_index.sql`](file:///d:/proect%20A/fixtures/02_dangerous_create_index.sql) | 🔴 FAIL | `SHARE` ⚠️ | `users`, `orders` | **2** | LG-002 |
| [`03_dangerous_fk.sql`](file:///d:/proect%20A/fixtures/03_dangerous_fk.sql) | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `order_items` | **1** | LG-003 |
| [`04_dangerous_alter_type.sql`](file:///d:/proect%20A/fixtures/04_dangerous_alter_type.sql) | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `invoices`, `user_profiles` | **2** | LG-004 |
| [`05_dangerous_unique.sql`](file:///d:/proect%20A/fixtures/05_dangerous_unique.sql) | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `subscriptions` | **1** | LG-005 |
| [`06_dangerous_drop_column.sql`](file:///d:/proect%20A/fixtures/06_dangerous_drop_column.sql) | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `customers`, `legacy_audit_logs` | **2** | LG-006 |
| [`07_dangerous_vacuum.sql`](file:///d:/proect%20A/fixtures/07_dangerous_vacuum.sql) | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `event_logs`, `all` | **2** | LG-007 |
| [`08_missing_lock_timeout.sql`](file:///d:/proect%20A/fixtures/08_missing_lock_timeout.sql) | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `users` | **1** | LG-008 |
| [`09_catastrophic_combined.sql`](file:///d:/proect%20A/fixtures/09_catastrophic_combined.sql) | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `transactions`, `accounts` | **7** | LG-001, LG-002, LG-003, LG-004, LG-005, LG-006, LG-008 |
| [`10_safe_migration.sql`](file:///d:/proect%20A/fixtures/10_safe_migration.sql) | 🟢 PASS | `ACCESS SHARE` | `accounts`, `transactions` | **0** | — *(Эталон)* |

---

## 3. Механика блокировок в PostgreSQL: почему это приводит к авариям

### Эффект блокировки начала очереди (Head-of-Line Blocking)
В PostgreSQL блокировка `ACCESS EXCLUSIVE` (накладываемая при большинстве `ALTER TABLE`, добавлении невалидированных констрейнтов или удалении колонок) **несовместима ни с какими операциями, включая обычный `SELECT`**.

```
[Пользовательский SELECT #1 (работает 1.5 сек)]  <-- держит ACCESS SHARE
                      │
[Миграция: ALTER TABLE users ...]               <-- ждет ACCESS EXCLUSIVE в очереди
                      │
[Пользовательский SELECT #2]                     <-- ЖДЕТ за миграцией!
[Пользовательский INSERT #3]                     <-- ЖДЕТ за миграцией!
[Пользовательский UPDATE #4]                     <-- ЖДЕТ за миграцией!
```

1. Пока долгий фоновый запрос или отчет держит слабый лок на таблице, миграция встает в очередь ожидания.
2. **Все входящие клиентские запросы встают за миграцией в очередь.**
3. За 3–5 секунд пул соединений PgBouncer (100–300 коннектов) полностью исчерпывается.
4. Веб-сервер начинает возвращать пользователям `HTTP 504 Gateway Timeout` — наступает масштабный инцидент на проде.

**Золотое правило LockGuard:** Любая миграция обязана устанавливать жесткий таймаут ожидания лока (`SET lock_timeout = '3s';`), чтобы отвалиться самой, но ни в коем случае не положить базу данных.

---

## 4. Каталог правил LockGuard (Top-10 Fatal Anti-Patterns)

### [LG-001] Добавление колонки с volatile DEFAULT
* **Уровень блокировки:** `ACCESS EXCLUSIVE` (Критический)
* **В чем опасность:** В PostgreSQL 11+ константные дефолты (`'active'`, `0`, `NULL`) и стабильные функции (`now()`) обновляются мгновенно на уровне метаданных (`atthasmissing`). Однако **volatile** функции (`random()`, `gen_random_uuid()`, `clock_timestamp()`) требуют вычисления уникального значения для каждой строки, что форсирует полную физическую перезапись всей таблицы на диске с эксклюзивным локом!
* **Небезопасный SQL:**
  ```sql
  ALTER TABLE users ADD COLUMN token UUID DEFAULT gen_random_uuid() NOT NULL;
  ```
* **Безопасный рецепт:**
  ```sql
  -- Шаг 1: Добавить nullable-столбец без дефолта (мгновенно)
  ALTER TABLE users ADD COLUMN token UUID;

  -- Шаг 2: Установить дефолт для будущих строк
  ALTER TABLE users ALTER COLUMN token SET DEFAULT gen_random_uuid();

  -- Шаг 3: Заполнить исторические данные фоновым скриптом пачками по 5000 строк
  -- UPDATE users SET token = gen_random_uuid() WHERE token IS NULL;

  -- Шаг 4: Поставить NOT NULL через валидацию констрейнта
  ALTER TABLE users ADD CONSTRAINT chk_users_token_nn CHECK (token IS NOT NULL) NOT VALID;
  ALTER TABLE users VALIDATE CONSTRAINT chk_users_token_nn;
  ALTER TABLE users ALTER COLUMN token SET NOT NULL;
  ALTER TABLE users DROP CONSTRAINT chk_users_token_nn;
  ```

---

### [LG-002] Создание индекса без CONCURRENTLY
* **Уровень блокировки:** `SHARE` (Критический)
* **В чем опасность:** Обычный `CREATE INDEX` полностью блокирует все операции записи (`INSERT`, `UPDATE`, `DELETE`) на время сканирования и построения B-Tree дерева. На таблицах от 1 млн строк это занимает минуты.
* **Небезопасный SQL:**
  ```sql
  CREATE INDEX idx_orders_user ON orders (user_id);
  ```
* **Безопасный рецепт:**
  ```sql
  -- ВНИМАНИЕ: Команда должна выполняться ВНЕ блока транзакции BEGIN...COMMIT
  CREATE INDEX CONCURRENTLY idx_orders_user ON orders (user_id);
  ```

---

### [LG-003] Добавление Foreign Key без NOT VALID
* **Уровень блокировки:** `ACCESS EXCLUSIVE` (Критический)
* **В чем опасность:** Прямой `ADD CONSTRAINT ... FOREIGN KEY` проводит полное последовательное сканирование (Seq Scan) всей дочерней таблицы под эксклюзивной блокировкой для валидации существующих строк.
* **Небезопасный SQL:**
  ```sql
  ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);
  ```
* **Безопасный рецепт:**
  ```sql
  -- Шаг 1: Привязать FK с флагом NOT VALID (мгновенный лок метаданных < 1мс)
  ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

  -- Шаг 2: Валидировать существующие строки (берет слабый лок SHARE UPDATE EXCLUSIVE - чтение и запись РАБОТАЮТ!)
  ALTER TABLE orders VALIDATE CONSTRAINT fk_user;
  ```

---

### [LG-004] Изменение типа колонки с полной перезаписью таблицы
* **Уровень блокировки:** `ACCESS EXCLUSIVE` (Критический)
* **В чем опасность:** `ALTER COLUMN TYPE` (например, `INT` в `BIGINT`, `VARCHAR(100)` в `TEXT`, `TIMESTAMPTZ` в `DATE`) требует конвертации и физической перезаписи каждого кортежа на диске, а также перестроения всех индексов таблицы.
* **Небезопасный SQL:**
  ```sql
  ALTER TABLE transactions ALTER COLUMN amount TYPE NUMERIC(18, 4);
  ```
* **Безопасный рецепт (Dual-Writing Pattern):**
  ```sql
  -- Фаза 1: Добавить новый теневой столбец
  ALTER TABLE transactions ADD COLUMN amount_new NUMERIC(18, 4);

  -- Фаза 2: Настроить триггер или двухстороннюю запись в ORM для входящих данных
  -- Запустить фоновый воркер для бэкфилла исторических строк

  -- Фаза 3: Быстрый свитч метаданных
  ALTER TABLE transactions RENAME COLUMN amount TO amount_old;
  ALTER TABLE transactions RENAME COLUMN amount_new TO amount;

  -- Фаза 4: Удаление старой колонки в следующем релизе
  ALTER TABLE transactions DROP COLUMN amount_old;
  ```

---

### [LG-005] Прямое создание UNIQUE ограничения
* **Уровень блокировки:** `ACCESS EXCLUSIVE` (Высокий)
* **В чем опасность:** `ALTER TABLE ADD CONSTRAINT ... UNIQUE (email)` неявно создает уникальный B-Tree индекс под монопольным эксклюзивным локом.
* **Небезопасный SQL:**
  ```sql
  ALTER TABLE accounts ADD CONSTRAINT uq_email UNIQUE (email);
  ```
* **Безопасный рецепт:**
  ```sql
  -- Шаг 1: Построить уникальный индекс в фоновом режиме без блокировки записи
  CREATE UNIQUE INDEX CONCURRENTLY uq_email_idx ON accounts (email);

  -- Шаг 2: Прикрепить констрейнт к готовому индексу (мгновенная операция метаданных)
  ALTER TABLE accounts ADD CONSTRAINT uq_email UNIQUE USING INDEX uq_email_idx;
  ```

---

### [LG-006] Немедленный DROP COLUMN или DROP TABLE в монолитном шаге
* **Уровень блокировки:** `ACCESS EXCLUSIVE` (Высокий)
* **В чем опасность:** Если приложение или реплика продолжают выполнять запросы, где в коде или ORM модели фигурирует удаляемое поле, удаление колонки приведет к немедленным падениям запросов `column not found`.
* **Безопасный рецепт (3-фазная депрекация):**
  1. **Релиз N:** Удалить поле из моделей ORM (Prisma `@ignore`, Drizzle/Django/Alembic exclude). Задеплоить код.
  2. **Мониторинг:** Убедиться по `pg_stat_statements`, что обращений к полю нет.
  3. **Релиз N+1:** Выполнить безопасный `ALTER TABLE tbl DROP COLUMN IF EXISTS col;`.

---

### [LG-007] VACUUM внутри миграционной транзакции
* **Уровень блокировки:** `SHARE UPDATE EXCLUSIVE` (Высокий)
* **В чем опасность:** PostgreSQL запрещает выполнение `VACUUM` внутри многооператорных транзакций (`BEGIN...COMMIT`) — миграция упадет с ошибкой ядра. Изменение параметров `autovacuum` в транзакции может вызывать дедлоки.
* **Безопасный рецепт:** Запускать регламентный `VACUUM ANALYZE` только отдельной командой вне транзакционных блоков.

---

### [LG-008] Отсутствие директивы SET lock_timeout
* **Уровень блокировки:** `ACCESS EXCLUSIVE` (Высокий)
* **В чем опасность:** Без `lock_timeout` миграция может бесконечно висеть в очереди ожидания лока, замораживая все входящие клиентские запросы за собой.
* **Безопасный рецепт:**
  В начале каждого миграционного файла обязательно указывать:
  ```sql
  SET lock_timeout = '3s';
  SET statement_timeout = '30s';
  ```
  *(Если миграция запускается внутри транзакции `BEGIN;`, используйте `SET LOCAL lock_timeout = '3s';`)*.

---

### [LG-009] Опасный ALTER COLUMN SET NOT NULL
* **Уровень блокировки:** `ACCESS EXCLUSIVE` (Критический)
* **В чем опасность:** Напрямую выполняя `SET NOT NULL`, PostgreSQL сканирует всю таблицу под монопольным локом, проверяя отсутствие `NULL`.
* **Безопасный рецепт:**
  ```sql
  -- Шаг 1: Создать проверочное ограничение с NOT VALID
  ALTER TABLE users ADD CONSTRAINT users_status_nn CHECK (status IS NOT NULL) NOT VALID;

  -- Шаг 2: Валидировать без блокировки записи
  ALTER TABLE users VALIDATE CONSTRAINT users_status_nn;

  -- Шаг 3: В PG 12+ теперь можно мгновенно выставить SET NOT NULL, опираясь на валидированный CHECK
  ALTER TABLE users ALTER COLUMN status SET NOT NULL;
  ALTER TABLE users DROP CONSTRAINT users_status_nn;
  ```

---

### [LG-010] CONCURRENTLY внутри транзакционного блока
* **Уровень блокировки:** `ACCESS EXCLUSIVE` (Критический)
* **В чем опасность:** В PostgreSQL операции `CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY` и `REINDEX CONCURRENTLY` **запрещены** внутри блоков `BEGIN ... COMMIT`. СУБД выбросит `ERROR 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`.
* **Безопасный рецепт:** Все `CONCURRENTLY` операции должны выполняться как одиночные автономные команды без обертки в транзакцию.

---

## 5. Пофайловый аудит и рецепты исправления

Ниже представлена детальная информация по каждому проверенному файлу:

### 📄 `fixtures/01_dangerous_add_column.sql`
* **Статус:** 🔴 **FAIL** | 2 нарушения (2 Critical) | Макс. лок: `ACCESS EXCLUSIVE`
* **Нарушения:**
  1. **L7 (`orders`)**: Колонка `created_at` имеет volatile default `clock_timestamp()`.
  2. **L8 (`payments`)**: Колонка `transaction_token` имеет volatile default `gen_random_uuid()`.

<details>
<summary>💡 Развернуть готовый безопасный SQL-рецепт для 01_dangerous_add_column.sql</summary>

```sql
SET lock_timeout = '3s';

-- 1. Для таблицы orders:
ALTER TABLE orders ADD COLUMN created_at TIMESTAMP;
ALTER TABLE orders ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- 2. Для таблицы payments:
ALTER TABLE payments ADD COLUMN transaction_token UUID;
ALTER TABLE payments ALTER COLUMN transaction_token SET DEFAULT gen_random_uuid();
```
</details>

---

### 📄 `fixtures/02_dangerous_create_index.sql`
* **Статус:** 🔴 **FAIL** | 2 нарушения (2 Critical) | Макс. лок: `SHARE`
* **Нарушения:**
  1. **L7 (`users`)**: Создание индекса `idx_users_email` без флага `CONCURRENTLY`.
  2. **L8 (`orders`)**: Создание индекса `idx_orders_created_at` без флага `CONCURRENTLY`.

<details>
<summary>💡 Развернуть готовый безопасный SQL-рецепт для 02_dangerous_create_index.sql</summary>

```sql
SET lock_timeout = '3s';

-- Выполнять вне транзакции BEGIN...COMMIT:
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
CREATE INDEX CONCURRENTLY idx_orders_created_at ON orders (created_at);
```
</details>

---

### 📄 `fixtures/03_dangerous_fk.sql`
* **Статус:** 🔴 **FAIL** | 1 нарушение (1 Critical) | Макс. лок: `ACCESS EXCLUSIVE`
* **Нарушения:**
  1. **L7 (`order_items`)**: Добавление внешнего ключа `fk_order` без флага `NOT VALID`.

<details>
<summary>💡 Развернуть готовый безопасный SQL-рецепт для 03_dangerous_fk.sql</summary>

```sql
SET lock_timeout = '3s';

-- Шаг 1: Мгновенное добавление без полного сканирования таблицы
ALTER TABLE order_items 
  ADD CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(id) NOT VALID;

-- Шаг 2: Фоновая валидация строк под слабым замком SHARE UPDATE EXCLUSIVE
ALTER TABLE order_items VALIDATE CONSTRAINT fk_order;
```
</details>

---

### 📄 `fixtures/04_dangerous_alter_type.sql`
* **Статус:** 🔴 **FAIL** | 2 нарушения (2 Critical) | Макс. лок: `ACCESS EXCLUSIVE`
* **Нарушения:**
  1. **L7 (`invoices`)**: Смена типа `total_amount` на `NUMERIC(14, 2)` (перезапись таблицы).
  2. **L8 (`user_profiles`)**: Смена типа `bio` на `TEXT` (перезапись таблицы).

---

### 📄 `fixtures/05_dangerous_unique.sql`
* **Статус:** 🔴 **FAIL** | 1 нарушение (1 High) | Макс. лок: `ACCESS EXCLUSIVE`
* **Нарушения:**
  1. **L7 (`subscriptions`)**: Прямой `ADD CONSTRAINT uq_customer_plan UNIQUE (customer_id, plan_id)`.

<details>
<summary>💡 Развернуть готовый безопасный SQL-рецепт для 05_dangerous_unique.sql</summary>

```sql
SET lock_timeout = '3s';

-- 1. Сначала строим индекс конкурентно
CREATE UNIQUE INDEX CONCURRENTLY uq_customer_plan_idx ON subscriptions (customer_id, plan_id);

-- 2. Прикрепляем готовый индекс как ограничение
ALTER TABLE subscriptions ADD CONSTRAINT uq_customer_plan UNIQUE USING INDEX uq_customer_plan_idx;
```
</details>

---

### 📄 `fixtures/06_dangerous_drop_column.sql`
* **Статус:** 🔴 **FAIL** | 2 нарушения (2 High) | Макс. лок: `ACCESS EXCLUSIVE`
* **Нарушения:**
  1. **L7 (`customers`)**: Монолитный `DROP COLUMN legacy_fax`.
  2. **L8 (`legacy_audit_logs`)**: Монолитный `DROP TABLE legacy_audit_logs`.

---

### 📄 `fixtures/07_dangerous_vacuum.sql`
* **Статус:** 🔴 **FAIL** | 2 нарушения (1 High, 1 Medium) | Макс. лок: `ACCESS EXCLUSIVE`
* **Нарушения:**
  1. **L7 (`event_logs`)**: Вызов `VACUUM FULL event_logs` блокирует таблицу полностью.
  2. **L10 (`all`)**: Модификация параметров `autovacuum` внутри транзакции.

---

### 📄 `fixtures/08_missing_lock_timeout.sql`
* **Статус:** 🔴 **FAIL** | 1 нарушение (1 High) | Макс. лок: `ACCESS EXCLUSIVE`
* **Нарушения:**
  1. **L1 (`users`)**: Отсутствует директива `SET lock_timeout`. Риск Head-of-Line Blocking.

---

### 📄 `fixtures/09_catastrophic_combined.sql` (Комбинированный антипаттерн)
* **Статус:** 🔴 **FAIL** | **7 нарушений** (4 Critical, 3 High) | Макс. лок: `ACCESS EXCLUSIVE`
* Содержит полную комбинацию типичных ошибок: транзакция `BEGIN`, неконкурентный индекс, добавление колонки с `gen_random_uuid()`, unvalidated FK, смену типа на `NUMERIC`, прямой UNIQUE и удаление колонки без депрекации.

---

### 📄 `fixtures/10_safe_migration.sql` (Эталон)
* **Статус:** 🟢 **PASSED** | **0 нарушений** | Макс. лок: `ACCESS SHARE`
* Содержит `SET lock_timeout`, concurrent-индексы, `NOT VALID` для FK и `USING INDEX` для UNIQUE.

---

## 6. Памятка разработчику: инструменты и лучшие практики

### ⚡ Быстрые команды CLI

```bash
# 1. Проверить миграции перед коммитом (только git-staged файлы)
npx lockguard check --staged

# 2. Проверить отличия ветки от main (для Pull Request)
npx lockguard check --changed origin/main

# 3. Автоматически вылечить неблокирующие проблемы (добавит lock_timeout и CONCURRENTLY)
npx lockguard check path/to/migration.sql --fix

# 4. Разбить тяжелую миграцию на фазы для вашего ORM (Prisma / Drizzle / Django / Alembic / SQL)
npx lockguard split path/to/migration.sql --orm=prisma

# 5. Смоделировать нагрузку и узнать риск 504 Gateway Timeout
npx lockguard simulate path/to/migration.sql

# 6. Проверить продакшен на наличие битых индексов после неудачного CONCURRENTLY
npx lockguard watchdog
```

### 🏷️ Инлайн-подавление правил в коде (Директивы)
Если вы уверены в безопасности конкретного запроса (например, таблица пустая, временная или создается в рамках этой же миграции):

* Подавить конкретное правило для следующей строчки:
  ```sql
  -- lockguard-ignore: LG-004
  ALTER TABLE legacy_temp ALTER COLUMN code TYPE bigint;
  ```
* Подавить все проверки для блока:
  ```sql
  -- lockguard-ignore-all
  ALTER TABLE internal_staging ALTER COLUMN payload TYPE jsonb;
  ```

---

*Отчет сгенерирован автоматически с помощью **LockGuard Zero-Downtime Migration Gatekeeper**.*
