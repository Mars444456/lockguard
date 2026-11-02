# Migration correctness / Корректность миграций

The corpus uses synthetic SQL and independently stated expectations. It contains no customer migrations or database exports. A passing case checks a specific rule or behavior; it is not a guarantee that the migration is safe under production load.

| Layer | Scope | Command |
| --- | --- | --- |
| `test/corpus/rules.cases.json` | Positive, contrasting and unknown cases for LG-001–LG-012; disabled and suppressed checks | `node --test test/migration-corpus.test.js` |
| `test/transaction-corpus.test.js` | Timeout scope, rollback, nested BEGIN, chaining, runner transactions and unsupported savepoints | `node --test test/transaction-corpus.test.js` |
| `test/plan-corpus.test.js` | Executed index and FK drafts, quoting, options, ONLY and legacy NOT NULL | `node --test test/plan-corpus.test.js` |
| `test/proof-boundaries.test.js` | Committed evidence, version-specific enforcement and lexical boundaries | `node --test test/proof-boundaries.test.js` |
| `integration/postgres-locks.cjs` | Real lock waits and catalog/behavior checks on PostgreSQL 14–18 in CI | `npm run test:postgres` |
| `e2e/customer-journey.spec.cjs` | Registration, email verification, team review and account recovery in Chromium | `npm run test:browser` |

Run `npm test` and `npm run build:browser` before submitting a core change. The browser and live PostgreSQL suites run separately in GitHub Actions. Live tests refuse remote databases and require `LOCKGUARD_TEST_DATABASE_URL` to name a disposable local `*_test` database; they create and remove a random schema. PGlite tests execute in an isolated embedded database and do not connect to a customer server. Mail and Pro controls used by browser tests belong only to their separate test fixture.

## Adding a regression

1. Reduce the problem to synthetic SQL. Check that the original SQL is valid and that the expected behavior follows from PostgreSQL documentation or an executed probe.
2. Record the expectation and reason before changing the analyzer. Do not turn the current engine output into the expected answer automatically.
3. Assert the relevant rule, evidence or behavior. For an unsupported construct, require `analysisComplete=false`, LG-000 and refusal to produce a phased draft. For excluded checks, require incomplete coverage.
4. Test both the failing case and a meaningful contrast. Execute proposed draft SQL and inspect catalog or data behavior when equivalence matters.
5. Verify disputed lock/version behavior on real PostgreSQL. Version 10–13 compatibility expectations use versioned documentation; the live CI matrix currently covers 14–18. Forced index-plan probes establish index capability, not measured production performance.

## Семантика и границы

Корпус проверяет все 12 правил на синтетических примерах. Отдельные тесты исполняют черновики в PGlite и сверяют ограничения, параметры индексов и поведение данных. Матрица CI проверяет реальные PostgreSQL 14–18. Это не измерение времени простоя и не доказательство корректности произвольного SQL.

Для нового дефекта сначала нужен воспроизводимый пример и ожидаемое поведение, затем исправление. Неподдерживаемые конструкции должны требовать ручной проверки, а не получать чистый результат. Отключённые правила и подавленные замечания остаются видимыми как неполное покрытие. Клиентский SQL, резервные копии, ключи и переписка в тесты не добавляются.

## PostgreSQL references

- [SET and rollback/savepoint scope](https://www.postgresql.org/docs/17/sql-set.html)
- [BEGIN inside an existing transaction](https://www.postgresql.org/docs/17/sql-begin.html)
- [Transaction chaining added in PostgreSQL 12](https://www.postgresql.org/docs/12/release-12.html)
- [PostgreSQL 11 ALTER TABLE](https://www.postgresql.org/docs/11/sql-altertable.html) and [PostgreSQL 12 ALTER TABLE](https://www.postgresql.org/docs/12/sql-altertable.html)
- [Multicolumn btree indexes](https://www.postgresql.org/docs/17/indexes-multicolumn.html)
