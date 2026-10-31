# A reproducible PostgreSQL migration review

These three SQL files describe a synthetic example, not a customer's database. The analyzer does not execute them.

1. `schema.sql`: an existing `accounts` / `orders` structure, with an index on `orders(account_id)`.
2. `before.sql`: an ordinary index build plus a foreign key added with `NOT VALID`.
3. `after.sql`: the index build changed to `CONCURRENTLY`, outside an explicit transaction. The foreign key is unchanged.

After installing Node.js 24+ and running `npm ci --ignore-scripts` in the repository root:

```sh
npm run demo:pilot
node bin/lockguard.js check fixtures/team-pilot/before.sql
node bin/lockguard.js check fixtures/team-pilot/after.sql
```

The build generates the public example from the current analyzer and the same comparison implementation used by the server. It does not read the local account database or activate any subscription.

| Input | Expected findings |
| --- | --- |
| Before, without a schema snapshot | LG-002 (ordinary index build), LG-011 (child-side index needs confirmation) |
| Before, with `schema.sql` as a structural snapshot | LG-002 |
| After, with the same structural snapshot | No findings in this example |

The standalone CLI commands above have no imported snapshot. The second command still reports LG-011: it cannot confirm the existing index from the migration alone. Its default failure threshold is HIGH; a zero exit code can still include a MEDIUM warning.

In the server's Pro workflow, the organization can save the snapshot, analyze both versions against it and compare saved runs: **one resolved finding, no introduced findings, the schema revision unchanged**. All 12 rules and the core API remain open source; Pro adds saved profiles, longer history and the comparison workflow.

This is static analysis, not a guarantee of no blocking. A snapshot can become stale. `NOT VALID` leaves existing rows unvalidated: schedule and review `VALIDATE CONSTRAINT` separately. Check how your migration runner handles transactions before using `CONCURRENTLY`, and test changes on a non-production database.

[Interactive walkthrough (Russian)](https://mars444456.github.io/lockguard/start.html) · [Open playground](https://mars444456.github.io/lockguard/) · [Discuss a pilot](https://mars444456.github.io/lockguard/#team-pilot)
