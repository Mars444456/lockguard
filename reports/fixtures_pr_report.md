<!-- lockguard-report -->
## 🛡️ LockGuard: PostgreSQL Migration Safety Gatekeeper

> ❌ **MERGE BLOCKED**: One or more migrations acquire dangerous PostgreSQL table locks (`ACCESS EXCLUSIVE` / `SHARE`) that can freeze your production database or cause 504 Gateway Timeouts.

### 📊 Summary

| Metric | Status |
| :--- | :--- |
| **Overall Verdict** | 🛑 **FAILED (Release Blocked)** |
| **Files Audited** | `10` |
| **Total Violations** | **20** (12 Critical, 7 High) |

### 📁 Migration Files & Max Lock Level

| File | Status | Max Lock Acquired | Affected Tables | Violations |
| :--- | :---: | :---: | :--- | :---: |
| `fixtures\01_dangerous_add_column.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `orders`, `payments` | **2** |
| `fixtures\02_dangerous_create_index.sql` | 🔴 FAIL | `SHARE` ⚠️ | `users`, `orders` | **2** |
| `fixtures\03_dangerous_fk.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `order_items` | **1** |
| `fixtures\04_dangerous_alter_type.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `invoices`, `user_profiles` | **2** |
| `fixtures\05_dangerous_unique.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `subscriptions` | **1** |
| `fixtures\06_dangerous_drop_column.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `customers`, `legacy_audit_logs` | **2** |
| `fixtures\07_dangerous_vacuum.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `event_logs`, `all` | **2** |
| `fixtures\08_missing_lock_timeout.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `users` | **1** |
| `fixtures\09_catastrophic_combined.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `transactions`, `accounts` | **7** |
| `fixtures\10_safe_migration.sql` | 🟢 PASS | `ACCESS SHARE` | `accounts`, `transactions` | **0** |

### ⚠️ Detailed Lock Anti-Patterns & Safe SQL Alternatives

#### 📄 `fixtures\01_dangerous_add_column.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🔴 **CRITICAL** | **Adding column with volatile or non-trivial DEFAULT** (`LG-001`) | `orders` | `ACCESS EXCLUSIVE` | L7 | Column 'created_at' on table 'orders' has a volatile DEFAULT 'clock_timestamp()'. This forces a full table rewrite on disk holding ACCESS EXCLUSIVE lock! |
| 2 | 🔴 **CRITICAL** | **Adding column with volatile or non-trivial DEFAULT** (`LG-001`) | `payments` | `ACCESS EXCLUSIVE` | L8 | Column 'transaction_token' on table 'payments' has a volatile DEFAULT 'gen_random_uuid()'. This forces a full table rewrite on disk holding ACCESS EXCLUSIVE lock! |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Adding column with volatile or non-trivial DEFAULT on <code>orders</code>)</b></summary>

```sql
-- Step 1: Add column without default (instant metadata update, no full table rewrite)
ALTER TABLE orders ADD COLUMN created_at TEXT;

-- Step 2: Set default for future rows
ALTER TABLE orders ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- Step 3: Backfill existing rows in small batches (run separately to avoid table lock)
-- UPDATE orders SET created_at = clock_timestamp() WHERE created_at IS NULL;

-- Step 4: If NOT NULL is required, set it after backfill using zero-downtime pattern
-- ALTER TABLE orders ADD CONSTRAINT orders_created_at_not_null CHECK (created_at IS NOT NULL) NOT VALID;
-- ALTER TABLE orders VALIDATE CONSTRAINT orders_created_at_not_null;
-- ALTER TABLE orders ALTER COLUMN created_at SET NOT NULL;
-- ALTER TABLE orders DROP CONSTRAINT orders_created_at_not_null;
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #2 (Adding column with volatile or non-trivial DEFAULT on <code>payments</code>)</b></summary>

```sql
-- Step 1: Add column without default (instant metadata update, no full table rewrite)
ALTER TABLE payments ADD COLUMN transaction_token TEXT;

-- Step 2: Set default for future rows
ALTER TABLE payments ALTER COLUMN transaction_token SET DEFAULT gen_random_uuid();

-- Step 3: Backfill existing rows in small batches (run separately to avoid table lock)
-- UPDATE payments SET transaction_token = gen_random_uuid() WHERE transaction_token IS NULL;

-- Step 4: If NOT NULL is required, set it after backfill using zero-downtime pattern
-- ALTER TABLE payments ADD CONSTRAINT payments_transaction_token_not_null CHECK (transaction_token IS NOT NULL) NOT VALID;
-- ALTER TABLE payments VALIDATE CONSTRAINT payments_transaction_token_not_null;
-- ALTER TABLE payments ALTER COLUMN transaction_token SET NOT NULL;
-- ALTER TABLE payments DROP CONSTRAINT payments_transaction_token_not_null;
```
</details>

#### 📄 `fixtures\02_dangerous_create_index.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🔴 **CRITICAL** | **Creating index without CONCURRENTLY** (`LG-002`) | `users` | `SHARE` | L7 | Index 'idx_users_email' on table 'users' is created without CONCURRENTLY. This takes a SHARE lock and BLOCKS ALL WRITES on production! |
| 2 | 🔴 **CRITICAL** | **Creating index without CONCURRENTLY** (`LG-002`) | `orders` | `SHARE` | L8 | Index 'idx_orders_reference' on table 'orders' is created without CONCURRENTLY. This takes a SHARE lock and BLOCKS ALL WRITES on production! |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Creating index without CONCURRENTLY on <code>users</code>)</b></summary>

```sql
-- Safe alternative: Build index concurrently without blocking writes
-- NOTE: Must run outside of a multi-statement BEGIN...COMMIT block
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #2 (Creating index without CONCURRENTLY on <code>orders</code>)</b></summary>

```sql
-- Safe alternative: Build index concurrently without blocking writes
-- NOTE: Must run outside of a multi-statement BEGIN...COMMIT block
CREATE INDEX CONCURRENTLY idx_orders_reference ON orders (reference_number);
```
</details>

#### 📄 `fixtures\03_dangerous_fk.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🔴 **CRITICAL** | **Adding Foreign Key without NOT VALID** (`LG-003`) | `order_items` | `ACCESS EXCLUSIVE` | L7 | Foreign Key 'fk_order_items_product' on 'order_items' referencing 'products' lacks 'NOT VALID'. It blocks all reads/writes during table validation! |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Adding Foreign Key without NOT VALID on <code>order_items</code>)</b></summary>

```sql
-- Step 1: Add foreign key with NOT VALID (instant lock acquisition, no full table scan)
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) NOT VALID;

-- Step 2: Validate existing rows in a separate statement (acquires only SHARE UPDATE EXCLUSIVE - writes proceed!)
ALTER TABLE order_items VALIDATE CONSTRAINT fk_order_items_product;
```
</details>

#### 📄 `fixtures\04_dangerous_alter_type.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🔴 **CRITICAL** | **Altering column type causing full table rewrite** (`LG-004`) | `invoices` | `ACCESS EXCLUSIVE` | L7 | Altering type of column 'amount' to 'BIGINT' on table 'invoices' forces a full table rewrite on disk under ACCESS EXCLUSIVE lock! |
| 2 | 🔴 **CRITICAL** | **Altering column type causing full table rewrite** (`LG-004`) | `user_profiles` | `ACCESS EXCLUSIVE` | L8 | Altering type of column 'bio' to 'VARCHAR(255)' on table 'user_profiles' forces a full table rewrite on disk under ACCESS EXCLUSIVE lock! |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Altering column type causing full table rewrite on <code>invoices</code>)</b></summary>

```sql
-- Safe 4-phase transition without downtime (dual-writing pattern):
-- Phase 1: Add new column without locking table
ALTER TABLE invoices ADD COLUMN amount_new BIGINT;

-- Phase 2: Create trigger / dual-write in application code for incoming writes
-- Backfill historical rows in small batches:
-- UPDATE invoices SET amount_new = amount WHERE amount_new IS NULL;

-- Phase 3: Rename columns in a quick metadata lock
-- ALTER TABLE invoices RENAME COLUMN amount TO amount_old;
-- ALTER TABLE invoices RENAME COLUMN amount_new TO amount;

-- Phase 4: Drop old column in later release
-- ALTER TABLE invoices DROP COLUMN amount_old;
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #2 (Altering column type causing full table rewrite on <code>user_profiles</code>)</b></summary>

```sql
-- Safe 4-phase transition without downtime (dual-writing pattern):
-- Phase 1: Add new column without locking table
ALTER TABLE user_profiles ADD COLUMN bio_new VARCHAR(255);

-- Phase 2: Create trigger / dual-write in application code for incoming writes
-- Backfill historical rows in small batches:
-- UPDATE user_profiles SET bio_new = bio WHERE bio_new IS NULL;

-- Phase 3: Rename columns in a quick metadata lock
-- ALTER TABLE user_profiles RENAME COLUMN bio TO bio_old;
-- ALTER TABLE user_profiles RENAME COLUMN bio_new TO bio;

-- Phase 4: Drop old column in later release
-- ALTER TABLE user_profiles DROP COLUMN bio_old;
```
</details>

#### 📄 `fixtures\05_dangerous_unique.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🟠 **HIGH** | **Adding UNIQUE constraint directly without concurrent index** (`LG-005`) | `subscriptions` | `ACCESS EXCLUSIVE` | L7 | UNIQUE constraint 'uq_subscriptions_user_plan' on 'subscriptions' is added directly. Use CREATE UNIQUE INDEX CONCURRENTLY + ADD CONSTRAINT USING INDEX instead. |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Adding UNIQUE constraint directly without concurrent index on <code>subscriptions</code>)</b></summary>

```sql
-- Step 1: Create unique index concurrently without blocking writes
CREATE UNIQUE INDEX CONCURRENTLY uq_subscriptions_user_plan_idx ON subscriptions (user_id, plan_id);

-- Step 2: Attach constraint using existing index (instant catalog operation)
ALTER TABLE subscriptions ADD CONSTRAINT uq_subscriptions_user_plan UNIQUE USING INDEX uq_subscriptions_user_plan_idx;
```
</details>

#### 📄 `fixtures\06_dangerous_drop_column.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🟠 **HIGH** | **Immediate DROP COLUMN or DROP TABLE in monolithic step** (`LG-006`) | `customers` | `ACCESS EXCLUSIVE` | L7 | DROP COLUMN 'legacy_address' on 'customers' executed directly. Ensure column is ignored in ORM (Prisma/Drizzle/Alembic) prior to dropping. |
| 2 | 🟠 **HIGH** | **Immediate DROP COLUMN or DROP TABLE in monolithic step** (`LG-006`) | `legacy_audit_logs` | `ACCESS EXCLUSIVE` | L8 | DROP TABLE 'legacy_audit_logs' in single step. Ensure tables are completely removed from ORM and all services before dropping. |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Immediate DROP COLUMN or DROP TABLE in monolithic step on <code>customers</code>)</b></summary>

```sql
-- Safe 3-Phase Deprecation Workflow:
-- Phase 1: Deploy code ignoring the column in your ORM (e.g. Prisma @ignore or schema exclude)
-- Phase 2: Verify zero active queries access the column
-- Phase 3: Drop column safely:
ALTER TABLE customers DROP COLUMN IF EXISTS legacy_address;
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #2 (Immediate DROP COLUMN or DROP TABLE in monolithic step on <code>legacy_audit_logs</code>)</b></summary>

```sql
-- Safe 3-Phase Deprecation Workflow:
-- Phase 1: Deploy code ignoring the column in your ORM (e.g. Prisma @ignore or schema exclude)
-- Phase 2: Verify zero active queries access the column
-- Phase 3: Drop column safely:
ALTER TABLE legacy_audit_logs DROP COLUMN IF EXISTS old_column;
```
</details>

#### 📄 `fixtures\07_dangerous_vacuum.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🟡 **MEDIUM** | **VACUUM or autovacuum storage parameter changes inside migration transaction** (`LG-007`) | `event_logs` | `SHARE UPDATE EXCLUSIVE` | L9 | Changing autovacuum settings (autovacuum_enabled = false) on table 'event_logs' inside migration script. Run outside migration transactions. |
| 2 | 🔴 **CRITICAL** | **VACUUM or autovacuum storage parameter changes inside migration transaction** (`LG-007`) | `all` | `ACCESS EXCLUSIVE` | L10 | VACUUM FULL locks tables completely (ACCESS EXCLUSIVE) and cannot be executed in standard migrations! |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (VACUUM or autovacuum storage parameter changes inside migration transaction on <code>event_logs</code>)</b></summary>

```sql
-- Run maintenance operations outside transactional migration scripts:
-- e.g. run via standalone DBA job or pg_cron:
ALTER TABLE event_logs SET (autovacuum_vacuum_scale_factor = 0.05);
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #2 (VACUUM or autovacuum storage parameter changes inside migration transaction on <code>all</code>)</b></summary>

```sql
-- Run maintenance operations outside transactional migration scripts:
-- e.g. run via standalone DBA job or pg_cron:
ALTER TABLE all SET (autovacuum_vacuum_scale_factor = 0.05);
```
</details>

#### 📄 `fixtures\08_missing_lock_timeout.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🟠 **HIGH** | **Missing SET lock_timeout directive in migration** (`LG-008`) | `global` | `ACCESS EXCLUSIVE` | L1 | No `SET lock_timeout` found in migration! If table locks cannot be acquired immediately, this migration will block all production traffic behind it. |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Missing SET lock_timeout directive in migration on <code>global</code>)</b></summary>

```sql
-- Add lock_timeout at the top, and RESET at the end to prevent pooler (PgBouncer) connection contamination:
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- ... (your migration statements here) ...

RESET lock_timeout;
RESET statement_timeout;
```
</details>

#### 📄 `fixtures\09_catastrophic_combined.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🔴 **CRITICAL** | **Adding column with volatile or non-trivial DEFAULT** (`LG-001`) | `accounts` | `ACCESS EXCLUSIVE` | L11 | Column 'token' on table 'accounts' has a volatile DEFAULT 'gen_random_uuid()'. This forces a full table rewrite on disk holding ACCESS EXCLUSIVE lock! |
| 2 | 🔴 **CRITICAL** | **Creating index without CONCURRENTLY** (`LG-002`) | `transactions` | `SHARE` | L8 | Index 'idx_transactions_created_at' on table 'transactions' is created without CONCURRENTLY. This takes a SHARE lock and BLOCKS ALL WRITES on production! |
| 3 | 🔴 **CRITICAL** | **Adding Foreign Key without NOT VALID** (`LG-003`) | `transactions` | `ACCESS EXCLUSIVE` | L14 | Foreign Key 'fk_tx_account' on 'transactions' referencing 'accounts' lacks 'NOT VALID'. It blocks all reads/writes during table validation! |
| 4 | 🔴 **CRITICAL** | **Altering column type causing full table rewrite** (`LG-004`) | `transactions` | `ACCESS EXCLUSIVE` | L20 | Altering type of column 'amount' to 'NUMERIC(18, 4)' on table 'transactions' forces a full table rewrite on disk under ACCESS EXCLUSIVE lock! |
| 5 | 🟠 **HIGH** | **Adding UNIQUE constraint directly without concurrent index** (`LG-005`) | `accounts` | `ACCESS EXCLUSIVE` | L23 | UNIQUE constraint 'uq_account_iban' on 'accounts' is added directly. Use CREATE UNIQUE INDEX CONCURRENTLY + ADD CONSTRAINT USING INDEX instead. |
| 6 | 🟠 **HIGH** | **Immediate DROP COLUMN or DROP TABLE in monolithic step** (`LG-006`) | `accounts` | `ACCESS EXCLUSIVE` | L26 | DROP COLUMN 'legacy_pin' on 'accounts' executed directly. Ensure column is ignored in ORM (Prisma/Drizzle/Alembic) prior to dropping. |
| 7 | 🟠 **HIGH** | **Missing SET lock_timeout directive in migration** (`LG-008`) | `global` | `ACCESS EXCLUSIVE` | L1 | No `SET lock_timeout` found in migration! If table locks cannot be acquired immediately, this migration will block all production traffic behind it. |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Adding column with volatile or non-trivial DEFAULT on <code>accounts</code>)</b></summary>

```sql
-- Step 1: Add column without default (instant metadata update, no full table rewrite)
ALTER TABLE accounts ADD COLUMN token TEXT;

-- Step 2: Set default for future rows
ALTER TABLE accounts ALTER COLUMN token SET DEFAULT gen_random_uuid();

-- Step 3: Backfill existing rows in small batches (run separately to avoid table lock)
-- UPDATE accounts SET token = gen_random_uuid() WHERE token IS NULL;

-- Step 4: If NOT NULL is required, set it after backfill using zero-downtime pattern
-- ALTER TABLE accounts ADD CONSTRAINT accounts_token_not_null CHECK (token IS NOT NULL) NOT VALID;
-- ALTER TABLE accounts VALIDATE CONSTRAINT accounts_token_not_null;
-- ALTER TABLE accounts ALTER COLUMN token SET NOT NULL;
-- ALTER TABLE accounts DROP CONSTRAINT accounts_token_not_null;
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #2 (Creating index without CONCURRENTLY on <code>transactions</code>)</b></summary>

```sql
-- Safe alternative: Build index concurrently without blocking writes
-- NOTE: Must run outside of a multi-statement BEGIN...COMMIT block
CREATE INDEX CONCURRENTLY idx_transactions_created_at ON transactions (created_at);
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #3 (Adding Foreign Key without NOT VALID on <code>transactions</code>)</b></summary>

```sql
-- Step 1: Add foreign key with NOT VALID (instant lock acquisition, no full table scan)
ALTER TABLE transactions ADD CONSTRAINT fk_tx_account FOREIGN KEY (account_id) REFERENCES accounts(id) NOT VALID;

-- Step 2: Validate existing rows in a separate statement (acquires only SHARE UPDATE EXCLUSIVE - writes proceed!)
ALTER TABLE transactions VALIDATE CONSTRAINT fk_tx_account;
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #4 (Altering column type causing full table rewrite on <code>transactions</code>)</b></summary>

```sql
-- Safe 4-phase transition without downtime (dual-writing pattern):
-- Phase 1: Add new column without locking table
ALTER TABLE transactions ADD COLUMN amount_new NUMERIC(18, 4);

-- Phase 2: Create trigger / dual-write in application code for incoming writes
-- Backfill historical rows in small batches:
-- UPDATE transactions SET amount_new = amount WHERE amount_new IS NULL;

-- Phase 3: Rename columns in a quick metadata lock
-- ALTER TABLE transactions RENAME COLUMN amount TO amount_old;
-- ALTER TABLE transactions RENAME COLUMN amount_new TO amount;

-- Phase 4: Drop old column in later release
-- ALTER TABLE transactions DROP COLUMN amount_old;
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #5 (Adding UNIQUE constraint directly without concurrent index on <code>accounts</code>)</b></summary>

```sql
-- Step 1: Create unique index concurrently without blocking writes
CREATE UNIQUE INDEX CONCURRENTLY uq_account_iban_idx ON accounts (iban);

-- Step 2: Attach constraint using existing index (instant catalog operation)
ALTER TABLE accounts ADD CONSTRAINT uq_account_iban UNIQUE USING INDEX uq_account_iban_idx;
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #6 (Immediate DROP COLUMN or DROP TABLE in monolithic step on <code>accounts</code>)</b></summary>

```sql
-- Safe 3-Phase Deprecation Workflow:
-- Phase 1: Deploy code ignoring the column in your ORM (e.g. Prisma @ignore or schema exclude)
-- Phase 2: Verify zero active queries access the column
-- Phase 3: Drop column safely:
ALTER TABLE accounts DROP COLUMN IF EXISTS legacy_pin;
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #7 (Missing SET lock_timeout directive in migration on <code>global</code>)</b></summary>

```sql
-- Migration runs inside a transaction block. Use SET LOCAL to scope lock_timeout to this transaction:
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
```
</details>

---
> 💡 **Why does LockGuard block this?**
> In PostgreSQL, `ACCESS EXCLUSIVE` locks block even simple `SELECT` queries. If an incoming DDL transaction cannot acquire this lock immediately because of an in-flight query, it blocks in queue and subsequently freezes **all** following read and write requests, creating a catastrophic cascading outage.

*Report generated automatically by [LockGuard CI/CD Gatekeeper](https://lockguard.dev)*