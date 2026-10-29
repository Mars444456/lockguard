<div align="center">

# 🛡️ LockGuard: PostgreSQL Zero-Downtime Migration Gatekeeper

### Automated CI/CD AST analyzer that detects dangerous table locks (`ACCESS EXCLUSIVE`) and blocks releases before taking down your production database.

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-LockGuard%20Gatekeeper-red?style=for-the-badge&logo=github)](https://github.com/marketplace/actions/lockguard-ci-cd-gatekeeper)
[![Zero Downtime](https://img.shields.io/badge/Postgres-Zero--Downtime-emerald?style=for-the-badge&logo=postgresql)](https://postgresql.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero%20(Pure%20Node.js)-blue?style=for-the-badge)](https://nodejs.org)
[![Tests Passing](https://img.shields.io/badge/Tests-22%2F22%20Passing-brightgreen?style=for-the-badge)](test/)

[Quickstart](#-quickstart-github-action) • [Why LockGuard?](#-why-lockguard) • [Rule Catalog](#-the-top-8-fatal-anti-patterns-detected) • [PR Comment Preview](#-what-lockguards-pr-comment-looks-like) • [Local CLI](#-local-cli-usage)

</div>

---

## 💥 Why LockGuard? The 30-Second Production Reality

In PostgreSQL, seemingly harmless DDL operations like:
```sql
ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT now();
CREATE INDEX idx_orders_user_id ON orders (user_id);
ALTER TABLE payments ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);
```
take **`ACCESS EXCLUSIVE`** or **`SHARE`** table locks. 

`ACCESS EXCLUSIVE` locks **everything** — including lightweight `SELECT` queries. Even worse, PostgreSQL uses a strict lock queue:

```
[1. Long-running SELECT query (4 sec)]
              ↓
[2. Migration DDL: ALTER TABLE requests ACCESS EXCLUSIVE (waiting in queue)]
              ↓
[3. Incoming client traffic: hundreds of quick 2ms SELECTs queue behind ALTER TABLE!]
              ↓
🔥 Entire connection pool saturated (PgBouncer max_connections exhausted)
💥 504 Gateway Timeouts across all microservices
```

**LockGuard is your automated CI/CD gatekeeper.** It parses migration SQL into an Abstract Syntax Tree (AST), identifies fatal lock anti-patterns, fails the GitHub Action check before merge, and posts a ready-to-copy safe multi-step SQL fix right inside the Pull Request.

---

## ⚡ Quickstart: GitHub Action

Add LockGuard to your repository in **under 60 seconds**.

Create `.github/workflows/lockguard.yml`:

```yaml
name: LockGuard Migration Gatekeeper

on:
  pull_request:
    paths:
      - 'migrations/**'
      - 'prisma/migrations/**'
      - 'drizzle/**'
      - '**/*.sql'

jobs:
  check-migration-locks:
    name: Audit PostgreSQL Table Locks
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      # 🛡️ Run LockGuard Action
      - name: Run LockGuard Gatekeeper
        uses: lockguard/action@v1
        with:
          migrations_dir: './migrations'
          format: 'github-pr-comment'
          severity: 'HIGH'
          output_file: 'lockguard-report.md'

      # 💬 Post Sticky Bot Comment on PR with Safe Fixes
      - name: Post PR Gatekeeper Comment
        if: always() && github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            if (fs.existsSync('lockguard-report.md')) {
              const body = fs.readFileSync('lockguard-report.md', 'utf8');
              github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: body
              });
            }
```

### Action Inputs

| Input | Description | Default | Required |
| :--- | :--- | :---: | :---: |
| `migrations_dir` | Directory containing SQL migrations (`./migrations`, `./prisma/migrations`, etc.) | `./migrations` | No |
| `format` | Output report format (`github-pr-comment`, `table`, `json`, `markdown`) | `github-pr-comment` | No |
| `severity` | Severity threshold that triggers failure (`CRITICAL`, `HIGH`, `MEDIUM`) | `HIGH` | No |
| `output_file` | File destination for the generated Markdown report | `lockguard-report.md` | No |
| `api_key` | Optional team license key for custom cloud telemetry | `""` | No |

---

## 🚨 The Top-8 Fatal Anti-Patterns Detected

LockGuard inspects your DDL against PostgreSQL's native lock conflict matrix:

| Rule ID | Anti-Pattern | Acquired Lock | Production Outage Consequence | Safe Zero-Downtime Replacement |
| :---: | :--- | :---: | :--- | :--- |
| **`LG-001`** | `ADD COLUMN` with volatile `DEFAULT` (`now()`, `uuid()`, functions) | `ACCESS EXCLUSIVE` | Rewrites every single row on disk under lock, freezing reads & writes. | Add column nullable $\rightarrow$ Set default for future rows $\rightarrow$ Backfill in batches. |
| **`LG-002`** | `CREATE INDEX` without `CONCURRENTLY` | `SHARE` | Blocks all `INSERT`, `UPDATE`, `DELETE` operations until index is built. | `CREATE INDEX CONCURRENTLY` (outside transaction block). |
| **`LG-003`** | `ADD CONSTRAINT FOREIGN KEY` without `NOT VALID` | `ACCESS EXCLUSIVE` | Sequential table scan holding exclusive lock on referenced tables. | Add with `NOT VALID` (instant catalog lock) $\rightarrow$ Separate `VALIDATE CONSTRAINT`. |
| **`LG-004`** | `ALTER COLUMN TYPE` requiring table rewrite | `ACCESS EXCLUSIVE` | Full table rewrite & index rebuilds under exclusive lock. | Add new column $\rightarrow$ Dual-write/backfill $\rightarrow$ Quick column swap. |
| **`LG-005`** | Direct `ADD CONSTRAINT UNIQUE` | `ACCESS EXCLUSIVE` | Freezes table for the entire duration of index creation. | `CREATE UNIQUE INDEX CONCURRENTLY` $\rightarrow$ `ADD CONSTRAINT ... USING INDEX`. |
| **`LG-006`** | Immediate `DROP TABLE` / `DROP COLUMN` | `ACCESS EXCLUSIVE` | Breaks active application servers with cached ORM models/queries. | 3-Phase deprecation: ORM ignore $\rightarrow$ Column rename $\rightarrow$ Physical drop. |
| **`LG-007`** | `VACUUM` / autovacuum params in migration | `SHARE UPDATE EXCLUSIVE` | Transaction aborts (`ERROR: VACUUM cannot run in transaction`) or causes worker deadlocks. | Run outside migration transaction or via standalone DBA job. |
| **`LG-008`** | Missing `SET lock_timeout` | Head-of-line blocking | Delayed DDL queues up and freezes all subsequent web requests. | Prepend `SET lock_timeout = '3s';` at the top of every migration file. |

---

## 💬 What LockGuard's PR Comment Looks Like

When a developer opens a Pull Request with an unsafe migration, LockGuard blocks the PR and leaves an actionable comment:

---

### Preview of GitHub PR Comment:

## 🛡️ LockGuard: PostgreSQL Migration Safety Gatekeeper

> ❌ **MERGE BLOCKED**: One or more migrations acquire dangerous PostgreSQL table locks (`ACCESS EXCLUSIVE` / `SHARE`) that can freeze your production database or cause 504 Gateway Timeouts.

### 📊 Summary

| Metric | Status |
| :--- | :--- |
| **Overall Verdict** | 🛑 **FAILED (Release Blocked)** |
| **Files Audited** | `1` |
| **Total Violations** | **3** (2 Critical, 1 High) |

### 📁 Migration Files & Max Lock Level

| File | Status | Max Lock Acquired | Affected Tables | Violations |
| :--- | :---: | :---: | :--- | :---: |
| `migrations/20261029_orders.sql` | 🔴 FAIL | `ACCESS EXCLUSIVE` ⛔ | `orders`, `transactions` | **3** |

### ⚠️ Detailed Lock Anti-Patterns & Safe SQL Alternatives

#### 📄 `migrations/20261029_orders.sql`

| # | Severity | Rule | Table | Lock Level | Line | Description |
| :-: | :---: | :--- | :--- | :---: | :-: | :--- |
| 1 | 🔴 **CRITICAL** | **Creating index without CONCURRENTLY** (`LG-002`) | `transactions` | `SHARE` | L8 | Non-concurrent index takes SHARE lock and BLOCKS ALL WRITES on production! |
| 2 | 🔴 **CRITICAL** | **Adding column with volatile DEFAULT** (`LG-001`) | `orders` | `ACCESS EXCLUSIVE` | L12 | Volatile DEFAULT `now()` forces full table rewrite holding ACCESS EXCLUSIVE lock! |
| 3 | 🟠 **HIGH** | **Missing SET lock_timeout directive** (`LG-008`) | `global` | `ACCESS EXCLUSIVE` | L1 | Migration missing lock_timeout safeguard. Risk of head-of-line blocking outage. |

<details>
<summary>💡 <b>Safe SQL Fix for #1 (Creating index without CONCURRENTLY on <code>transactions</code>)</b></summary>

```sql
-- Safe alternative: Build index concurrently without blocking writes
-- NOTE: Must run outside of a multi-statement BEGIN...COMMIT block
CREATE INDEX CONCURRENTLY idx_transactions_created_at ON transactions (created_at);
```
</details>

<details>
<summary>💡 <b>Safe SQL Fix for #2 (Adding column with volatile DEFAULT on <code>orders</code>)</b></summary>

```sql
-- Step 1: Add column without default (instant metadata update, no full table rewrite)
ALTER TABLE orders ADD COLUMN updated_at TIMESTAMP;

-- Step 2: Set default for future rows
ALTER TABLE orders ALTER COLUMN updated_at SET DEFAULT now();

-- Step 3: Backfill existing rows in small batches (run separately to avoid table lock)
-- UPDATE orders SET updated_at = now() WHERE updated_at IS NULL;
```
</details>

---
> 💡 **Why does LockGuard block this?**  
> In PostgreSQL, `ACCESS EXCLUSIVE` locks block even simple `SELECT` queries. If an incoming DDL transaction cannot acquire this lock immediately because of an in-flight query, it blocks in queue and subsequently freezes **all** following read and write requests, creating a catastrophic cascading outage.

*Report generated automatically by [LockGuard CI/CD Gatekeeper](https://github.com/marketplace/actions/lockguard-ci-cd-gatekeeper)*

---

## 💻 Local CLI Usage

Lint migrations locally before pushing to git:

```bash
# Check migrations with colorized terminal summary
npx lockguard check ./migrations

# Check single file
node bin/lockguard.js check fixtures/09_catastrophic_combined.sql

# Output GitHub PR Markdown
node bin/lockguard.js check ./migrations --format=github-pr-comment

# Output JSON for custom integrations
node bin/lockguard.js check ./migrations --format=json

# View the catalog of Top-8 fatal PostgreSQL rules
node bin/lockguard.js rules

# Scaffold workflow file into .github/workflows/lockguard.yml
node bin/lockguard.js init
```

---

## 🧪 Local Web Dashboard & Interactive Playground

LockGuard includes a built-in interactive visualizer and SQL playground:

```bash
npm start
```

Visit **`http://localhost:3000`** to:
- 🧪 Paste raw SQL or load presets to visually inspect AST lock trees.
- 🚀 View live Pull Request audit logs and simulate webhook checks.
- 🔑 Manage Team API keys and configure rule thresholds.
- 💳 Manage subscription tiers (Free, Team $39/mo, Business $99/mo).

---

## 🏗️ Architecture & Philosophy

- **Zero External Dependencies:** Built using native modern Node.js primitives (`node:http`, `node:fs`, `node:test`, `node:crypto`). Instant boot, no `node_modules` bloat in CI.
- **AST-Powered:** Real PostgreSQL DDL grammar parsing (not fragile regexes matching keywords). Resilient to comments, quotes, multi-statement blocks, and dialect nuances.
- **Fail-Safe CI Gatekeeper:** Returns exit code `1` whenever an unmitigated fatal lock is detected, protecting your main branch by default.

---

## 📄 License

MIT © 2026 LockGuard Team
