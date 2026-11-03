# Development workflow / Разработка

Use the tracked issue identifier in branch names and PR titles, for example `codex/mar-123-short-description` and `MAR-123: Describe the change`.

Use `Fixes MAR-123` in the PR description only when merging that PR completes the issue. For partial work, use `Part of MAR-123` and leave the remaining acceptance criteria open.

The MAR team's configured PR workflow is: draft → no automatic status change; open for review → In Review; review activity → In Review; ready to merge → no completion; merged closing PR → Done. Closing a PR without merging must not be treated as task completion. These are workspace settings and must be verified after integration or workflow changes.

Keep public GitHub comments and GitHub Issues mirroring disabled unless explicitly agreed. Do not copy private issue descriptions, conversations, credentials, database backups or customer SQL into public PRs. Installation access should be limited to the intended repository.

Run checks appropriate to the change; see [TESTING.md](TESTING.md). Wait for required CI before merging, then verify the resulting Linear status rather than reporting completion from the configuration alone.

## Русский

Указывайте номер задачи в названии ветки и PR: `codex/mar-123-short-description`, `MAR-123: Описание изменения`. Для полного завершения задачи используйте `Fixes MAR-123`, для частичной работы — `Part of MAR-123`.

Черновик не закрывает задачу. Готовый PR и его ревью переводят её в In Review; готовность к слиянию сама по себе не означает Done. Закрытие PR без слияния не подтверждает выполнение. После слияния проверяйте фактический статус в Linear.

В публичные материалы входят только сведения об изменении продукта. Приватные обсуждения, описания внутренних задач, секреты, базы и клиентский SQL не публикуются. Публичные комментарии интеграции и синхронизация GitHub Issues включаются только по отдельному решению.
