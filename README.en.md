[Русский](README.md) · [**English**](README.en.md)

# LockGuard

Review PostgreSQL migration SQL before release. LockGuard uses the PostgreSQL AST to flag known table-locking risks, produce CI reports and prepare draft change plans for manual review.

[Open English demo](https://mars444456.github.io/lockguard/?lang=en) · [First 10 minutes](https://mars444456.github.io/lockguard/start.html?lang=en) · [Rules](#rule-catalog) · [GitHub Action](#github-action) · [Contact](https://mars444456.github.io/lockguard/contacts.html?lang=en)

[![CI](https://github.com/Mars444456/lockguard/actions/workflows/lockguard.yml/badge.svg?branch=main)](https://github.com/Mars444456/lockguard/actions/workflows/lockguard.yml) [![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

The website, pilot walkthrough and server workspace have a **RU / EN** switch. Your choice is saved in the browser, and `?lang=en` or `?lang=ru` selects a language directly. Switching does not change SQL, object names or user-provided data.

The public demo analyzes SQL in your browser without an account. **Sign in** offers the [online test workspace](https://lockguard-test-cabinet.onrender.com/?lang=en#account) and the local application. The free test workspace has temporary storage: accounts, history and schemas may reset on restart. Use sample data only; a permanent public workspace for production data is not hosted yet. The local workspace runs at [localhost:3000](http://localhost:3000/?lang=en).

For a team pilot, [discuss reviewing 1–3 sanitized migrations](https://mars444456.github.io/lockguard/?lang=en#team-pilot). Scope, schedule and terms are agreed before work begins. No production database access is needed. [Reproducible example](fixtures/team-pilot/README.md).

## Features

- PostgreSQL AST parsing with `libpg-query` and 12 migration rules.
- Fail-closed results for unsupported constructs: `LG-000` and `analysisComplete: false` require manual review.
- Local CLI, staged and changed-file checks, and a GitHub Action.
- Terminal, JSON, Markdown, GitHub PR comment and SARIF output formats.
- Browser-only SQL review and draft phased changes for supported findings.
- Server workspace with account-scoped history and API keys.
- Pro workflow with saved schemas, longer history, before / after comparisons and private team reviews.
- GitHub webhook signature verification and PR SQL analysis; commit-status publishing is configured separately.
- Robokassa integration with test mode, verified ResultURL notifications and duplicate-payment protection.

**Static analysis does not guarantee zero downtime.** Rules cover a subset of PostgreSQL operations. Uncalibrated duration, load and financial-loss forecasts have been removed. See [product status and commercial readiness](PRODUCT-STATUS.md). Review the actual schema, transaction boundaries and load, and test changes before deployment.

## Quick start

Requires **Node.js 24 or newer** and npm. CI uses Node.js 24. The server uses built-in `node:sqlite`, which emits an experimental warning on Node.js 24.12.

```sh
git clone https://github.com/Mars444456/lockguard.git
cd lockguard
npm ci --ignore-scripts
node bin/lockguard.js check fixtures/10_safe_migration.sql
node bin/lockguard.js rules
npm test
```

## Local CLI

```sh
node bin/lockguard.js check ./migrations
node bin/lockguard.js check ./migrations --strict --format=json
node bin/lockguard.js check ./migrations --format=sarif --output=lockguard.sarif
node bin/lockguard.js check --changed origin/main
node bin/lockguard.js check --staged
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | No violations at the selected failure threshold |
| 1 | Violations found |
| 2 | Startup, input or analysis error |

`--strict` also fails on warnings. Do not treat every nonzero exit as a successful analysis. `--staged` reads SQL from the Git index, including partially staged files. It cannot be combined with `--fix`: edit working files, review the diff and stage them again.

## Rule catalog

| Rule | Check |
| --- | --- |
| LG-001 | Added column with a volatile or nontrivial DEFAULT |
| LG-002 | Index built without CONCURRENTLY |
| LG-003 | Foreign key added without NOT VALID |
| LG-004 | Column type change that may rewrite the table |
| LG-005 | Direct UNIQUE constraint without a concurrently built index |
| LG-006 | Immediate table or column removal |
| LG-007 | VACUUM or autovacuum settings inside a transaction |
| LG-008 | Missing or ineffective lock_timeout before DDL |
| LG-009 | SET NOT NULL without a previously validated constraint |
| LG-010 | CONCURRENTLY inside a transaction block |
| LG-011 | Foreign key without a confirmed supporting child-column index |
| LG-012 | TRUNCATE; REFRESH MATERIALIZED VIEW without CONCURRENTLY |

`LG-000` means analysis is incomplete and manual review is required. See [rule implementations](src/core/rules/) or run `node bin/lockguard.js rules`.

## GitHub Action

Add `.github/workflows/lockguard.yml` to your repository:

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

The Action checks the selected directory and saves a report. It does not automatically post a PR comment. Pin a verified commit SHA instead of `main` for reproducibility.

This project's CI runs tests, verifies generated browser assets and audits migration SQL changed in a PR against its base commit. Deliberately unsafe SQL under `fixtures/` and `test/` is covered by tests and excluded from the real-migration audit.

Before publishing, run `npm run check:privacy`. It checks working files and staged copies for conversation links, private keys and accidentally tracked environment files, databases and private directories. It does not intercept `git push`, detect every kind of personal information or inspect images. Review the actual publication contents as well.

## A finding and a draft change

```sql
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

On an existing table, LG-002 flags the write-blocking ordinary index build. A possible draft to review:

```sql
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders(user_id);
RESET lock_timeout;
```

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block. Applicability also depends on the table, schema and migration runner.

```sh
node bin/lockguard.js split ./migrations/001.sql --write --out-dir=./migration-drafts
node bin/lockguard.js check ./migrations/001.sql --fix
```

Generated phases are **drafts for manual review**, not an equivalent replacement for the original migration. Check all original operations, data movement, constraints, release ordering and rollback. Backfill templates need bounded batches and testing. `--fix` changes the source file; save it in Git first and review the resulting diff.

## Server workspace and API

```sh
npm start
```

Open [localhost:3000](http://localhost:3000/?lang=en). Opening the HTML file directly does not start the API server. For a new installation, copy `.env.example` to `.env`; preserve an existing `.env`.

Choose **Sign in / Register** and supply an email, a password of at least 12 characters and an organization name. Each account has its own organization, history and API keys. `LOCKGUARD_ADMIN_TOKEN` is a separate operator secret for the main profile and payment settings; it is kept only in tab memory by the Administrator button. Do not distribute it to customers. Private APIs require authentication.

SQL entered in the server workspace is sent to that server. The GitHub Pages demo analyzes it locally in the browser. **GitHub Pages cannot run the Node.js API or receive payment callbacks.**

Data is stored in `data/lockguard.sqlite3`. Organization access is determined by the server session, not a submitted organization ID. Changing a password revokes previous sessions; signing out clears private UI data.

Legacy JSON databases are imported once, keeping the source and a separate backup. Stop the old server before migration. SQLite supports multiple processes on one server; multiple hosts need a separate server database. Pro supports invited organization members with owner, editor and reviewer roles. Offline recovery codes work without a mail provider; email recovery requires a configured sender. Registration email verification is not implemented. [Reviews, recovery and deployment](OPERATIONS.md#english).

## LockGuard Pro

| Feature | Community | Server Pro |
| --- | --- | --- |
| All 12 rules, local CLI and browser analysis | Yes · MIT | Yes |
| Schema-file input in the open CLI | Yes | Yes |
| Workspace history | 100 recent checks | 1,000 recent checks |
| Saved organization schemas | — | Up to 10 |
| Analysis using a saved schema | — | Workspace and API key |
| Review comparison | — | Introduced, resolved and persisting findings |
| Team review | — | Up to 20 members and 100 private cards |
| Change approval | — | Independent reviewer, attestations, expiring waivers and decision history |

SQL snapshots import as v2 with source column types; v1 JSON remains supported without type metadata. LG-004 distinguishes a known integer rewrite, supported VARCHAR widening and missing context. Avoiding a heap rewrite does not remove ACCESS EXCLUSIVE. Type changes require dependency review instead of an automatically generated column swap. New-column backfill uses bounded batches of 5,000 rows with a separate completion check.

Upload SQL or JSON structure files up to 512 KB in **Schemas PRO**. SQL is not executed; only normalized structure is saved. Supported input includes a limited set of CREATE TABLE, CREATE INDEX and constraint definitions, not arbitrary full `pg_dump` output. [Example JSON snapshot](examples/schema.snapshot.json).

```sh
node bin/lockguard.js check ./migration.sql --schema=./examples/schema.snapshot.json --strict
```

Multiple files require `--isolated`: each is checked independently against the same snapshot. A snapshot does not replay migration sequences or verify itself against a live database. Update it after schema changes. Partial, invalid or semantically unconfirmed indexes do not prove FK coverage. Validated CHECK ... IS NOT NULL constraints are considered for PostgreSQL 12+.

While payment setup is pending, the server operator can grant or revoke access for an existing account:

```sh
npm run pro -- grant user@example.com 30
npm run pro -- revoke user@example.com
```

These commands require server file access, create no payment and do not expose a self-service upgrade API. Entitlements and expiry are enforced by the server. Purchasing an audit does not automatically include Pro. After Pro expires, schema export and deletion remain available, while schema-aware workspace analysis and comparison are blocked. New history writes trim history to the Community limit.

For API analysis, send a `schemaId` from `/api/v1/schemas` with `sql` and an API key from the Pro organization to `/api/v1/analyze`. Older reports without structured findings and incomplete analyses cannot be compared.

## Backups

`npm run backup` creates a checked SQLite backup. Backups contain private account data and password hashes: restrict access and store copies separately from the live database. Automatic transfer to external storage is not configured. Restoration creates a new database file, verifies integrity and revokes browser sessions; it does not overwrite the current database. See the [deployment and recovery guide](DEPLOYMENT.md) for commands and settings.

## Services and payment

| Offering | Price | Terms |
| --- | --- | --- |
| Community | Free | Open core, local CLI and browser demo |
| Pro | 1 500 ₽ / 30 days | Saved schemas, schema-aware analysis, 1,000 recent checks and comparison; instance address confirmed before payment |
| PostgreSQL migration audit | 30 000 ₽ / one-off order | Scope, materials and schedule agreed in writing before payment; electronic report and recommendations |

Renewal is a separate payment without automatic charges. **Online payments through Robokassa are still being connected.** Integration code being present does not mean the merchant account is activated or real payments are available. Agree on an order through the [project contacts](https://mars444456.github.io/lockguard/contacts.html?lang=en) before paying.

Payment requires an HTTPS server configured with Robokassa secrets, ResultURL and self-employed receipt services. Keep secrets in server environment variables. Test payments and a return to SuccessURL do not confirm a live payment or activate production access. Refunds are handled through support and the provider's dashboard; automatic refund synchronization and access revocation are not implemented. Generated B2B invoices are samples without banking details and must not be used to transfer money.

## Contact and terms

[Contact, orders and provider details](https://mars444456.github.io/lockguard/contacts.html?lang=en) · [Offer and refunds](https://mars444456.github.io/lockguard/offer.html?lang=en) · [Privacy](https://mars444456.github.io/lockguard/privacy.html?lang=en)

You can [support development on DonationAlerts](https://www.donationalerts.com/r/marswwu). Donations are voluntary and do not purchase Pro or an audit.

## Development

```sh
npm test
npm run build:browser
npm run build:legal
```

The optional `npm run test:postgres` suite needs a disposable local PostgreSQL database, with `LOCKGUARD_TEST_DATABASE_URL` pointing to a database whose name ends in `_test`. Ordinary `npm test` does not connect to an external database. CI is configured for PostgreSQL 14–18, including real locks and heap rewrite behavior. Check CI for the outcome of a specific run. Only a random test schema is created and removed.

- `src/core/`: parser, rules, report formats and draft generation.
- `src/cli/`, `bin/`: CLI, Git hook and Telegram bot.
- `src/server/`, `src/ui/`: server and workspace UI.
- `docs/`: GitHub Pages site and generated browser assets.
- `src/ui/i18n-catalog.js`: Russian source strings, English translations and parameterized UI messages.
- `src/ui/i18n.js`: local language selection, text binding and protected user-content boundaries. No external translation service is used.
- `config/seller.json`: public provider details used to generate legal pages.
- `test/`: rule, CLI, HTTP, storage, integration and PGlite tests.

After core or UI changes, run `npm run build:browser` and include generated assets. After provider-detail changes, run `npm run build:legal`. Both builds preserve the language controls on generated pages.
