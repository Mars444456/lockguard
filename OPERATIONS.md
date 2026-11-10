# Ревью, восстановление и хранение

[English](#english) · [Русский](#ревью-восстановление-и-хранение)

## Совместная работа в Pro

В серверном кабинете откройте историю проверок. Владелец создаёт приглашение для конкретного email с ролью редактора или рецензента. Код показывается один раз, действует 48 часов и принимается вошедшим пользователем с указанным адресом. Передавайте его лично. Создавать и принимать приглашения могут только пользователи с подтверждённым email. В личном кабинете запросите письмо, откройте ссылку в течение 30 минут, войдите в тот же аккаунт и нажмите «Подтвердить email». Открытие ссылки само по себе ничего не подтверждает. Повторное письмо отзывает прежнюю ссылку; смена пароля также отзывает неподтверждённые ссылки. Пока доставка писем не настроена, приглашения закрыты, обычный SQL-анализ доступен.

| Роль | Возможности |
| --- | --- |
| Владелец | Настройки организации, ключи и участники, схемы, изменения, временные исключения |
| Редактор | Анализ и сохранение проверок, схемы, карточки и подтверждения |
| Рецензент | Чтение организации, комментарии, запрос изменений и независимое согласование |

Участник сохраняет личную организацию и переключается между доступными пространствами. Смена пространства действует на сеанс; устаревшая вкладка не может записать данные, выдавая их за прежнюю организацию. Лимит Pro: 20 участников и 100 карточек.

Отзыв участника запрещает последующий доступ на сервере. При следующем действии старая вкладка очищает прежние карточки и схемы и обновляет выбранную организацию. Это не удаляет уже скачанные пользователем файлы. Запоздалые ошибки запросов из прежнего входа или пространства не сбрасывают новое состояние аккаунта.

Карточка фиксирует результат конкретной проверки, хеш SQL, версию и ревизию снимка схемы. Сохранение полного SQL в карточке — отдельный выбор; сервер сверяет его хеш с проверкой. Ссылка открывается только после входа участника организации. Публичной публикации SQL нет.

Автор не согласует собственное изменение. Для согласования нужны подтверждения актуальности контекста, backfill, совместимости приложения и проверки на тестовой базе. Высокие и критические замечания требуют устранения либо отдельного исключения владельца с причиной и сроком до 90 дней. Истечение исключения требует повторного рассмотрения. Согласование — решение команды, не гарантия отсутствия аварии. Уведомления коллегам автоматически не рассылаются.

После окончания Pro карточки можно читать и экспортировать; владелец может их удалить. Изменять карточки и приглашать новых участников без Pro нельзя. Существующие участники сохраняют чтение — при необходимости владелец отзывает доступ.

## Восстановление доступа

После входа откройте «Личный кабинет → Резервный код восстановления», подтвердите пароль и сохраните показанный код в менеджере паролей. Он действует год, показывается один раз и заменяет предыдущий. На `reset.html` укажите email, код и новый пароль. Код одноразовый; смена пароля отзывает прежние сеансы и все коды восстановления.

Подтверждение email и почтовое восстановление требуют переменных окружения `LOCKGUARD_MAIL_API_KEY` и `LOCKGUARD_MAIL_FROM` для проверенного отправителя Resend, а также HTTPS `APP_URL`. Gmail-адрес сам по себе не даёт права отправлять от него через Resend. До настройки запрос письма сообщает о недоступности сервиса. Ключи не коммитьте и не отправляйте в чат. Реальные письма из тестов не отправляются. Для подтверждения действует ограничение: не чаще одного письма в минуту и до 10 писем в сутки на аккаунт. При отказе провайдера интерфейс сообщает об ошибке и подтверждение не засчитывается. Восстановление по письму также подтверждает владение email; резервный офлайн-код этого не делает. [API провайдера](https://resend.com/docs/api-reference/emails/send-email).

Ссылка восстановления хранит одноразовый токен во фрагменте URL, не в query; страница сразу удаляет фрагмент из адреса. Не помещайте токен в логи. Токены хранятся в БД только как SHA-256; почтовый код действует 30 минут.

## Проверяемые резервные копии

Владельцу в «История проверок → Сохранность данных» доступны статус копирования, последняя попытка и последняя успешная копия. Сбой хранится как служебный статус без текста исключения, путей и ключей. Следующая успешная проверенная копия снимает текущую ошибку; историческое время сбоя сохраняется. Просроченная или ошибочная копия не подтверждает служебную готовность. Этот блок не заменяет внешний мониторинг, уведомления и независимое хранилище.

Планировщик использует `LOCKGUARD_BACKUP_HOURS` (по умолчанию 24, от 1 до 8760 часов) и `LOCKGUARD_BACKUP_RETENTION` (по умолчанию 7, от 1 до 100 файлов). После перезапуска срок следующей копии отсчитывается от сохранённого времени последней успешной копии. Если копии нет, срок истёк, дата некорректна или находится в будущем, либо последняя попытка завершилась ошибкой, копирование начинается сразу. Следующая попытка назначается через настроенный интервал после завершения текущей, включая сбой; одновременных попыток нет. Остановка планировщика отменяет будущие попытки, но не прерывает уже начатую копию.

```sh
npm run backup
npm run verify:restore
```

`verify:restore` восстанавливает копию в отдельный временный каталог, сравнивает контрольные суммы записей и проверяет отзыв сеансов, приглашений и кодов. Он не заменяет основную БД. Владельцу в блоке «Сохранность данных» видны статус, последняя попытка и последняя успешная проверка восстановления. Сбой, незавершённая попытка или успех старше семи дней исключают служебную готовность, даже если предыдущая проверка прошла недавно. Успех фиксируется после удаления временных данных. Следующая полная успешная проверка снимает текущую ошибку; историческая дата сбоя сохраняется. Статусы сохраняются после перезапуска, а сообщения CLI не содержат исходных исключений с путями или секретами. При ошибке очистки оператор должен проверить временное хранилище перед повтором; статус «Ошибка» не подтверждает удаление данных. Эта диагностика не заменяет внешнюю копию и проверку независимого хранилища.

Для шифрования задайте `LOCKGUARD_BACKUP_KEY`: случайный ключ из 32 байт в base64, полученный в менеджере секретов. Копии используют AES-256-GCM с новым случайным IV. Ключ храните отдельно от копий; без него восстановление невозможно. При ошибке шифрования резервирование завершается ошибкой, не сохраняя незашифрованную резервную копию как запасной вариант. Ранее существовавшие незашифрованные копии автоматически не удаляются.

Для восстановления укажите новый путь на файловой системе с поддержкой жёстких ссылок, например NTFS или ext4.

```sh
node --env-file-if-exists=.env scripts/restore-db.js /secure/backup.sqlite3.enc /secure/restored.sqlite3
```

Скрипт готовит базу в закрытом временном каталоге на том же диске и публикует её по указанному пути после отзыва прежних сеансов, приглашений и кодов. Уже занятый путь или соседний журнал SQLite приводят к отказу. При принудительной остановке проверьте временные папки `.lockguard-restore-*` рядом с указанным путём. Они могут содержать данные резервной копии.

Восстановление возвращает сохранённые аккаунты, членство, схемы, проверки, карточки и заказы. Восстановленные API-ключи сохраняют прежнее состояние: если копия могла быть раскрыта, оператор должен отозвать ключи отдельно.

Для проверки внешней копии скачайте готовый `.sqlite3.enc` в закрытый локальный каталог или прочитайте его с отдельного диска. Загрузите тот же ключ шифрования в окружение проверяющего процесса и укажите фактически полученный файл.

```sh
npm run verify:restore -- --from "/secure/received/lockguard-backup.sqlite3.enc"
```

Команда проверяет подлинность файла, восстанавливает временную базу, сверяет записи и проверяет отзыв временных учётных данных. Этот режим работает отдельно от рабочей базы и её статуса готовности. Место хранения подтверждает оператор, поскольку один и тот же файл можно проверить из любого каталога.

### Автоматическая копия в Google Drive

1. В рабочем аккаунте включите Google Drive API в отдельном проекте Google Cloud. Создайте OAuth-клиент типа Desktop app и выберите область `drive.file`. Для постоянной выгрузки переведите OAuth-приложение в режим In production перед выдачей токена. В режиме Testing токен обновления для Drive истекает через семь дней. [Области Google Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) · [Срок действия токена](https://developers.google.com/identity/protocols/oauth2/#expiration).
2. В `rclone config` настройте подключение Drive со своим OAuth-клиентом и областью `drive.file`. Создайте через это подключение отдельную закрытую папку командой `rclone mkdir lockguardbackup:LockGuard-automatic-backups`. Для идентификатора папки используйте поле `ID` из `rclone lsjson --stat lockguardbackup:LockGuard-automatic-backups`. Папка, созданная через веб-интерфейс, может быть недоступна этому подключению. [Настройка rclone](https://rclone.org/drive/).
3. В секретах сервера укажите `LOCKGUARD_BACKUP_DRIVE_FOLDER` с идентификатором папки, `LOCKGUARD_BACKUP_DRIVE_CLIENT_ID` и `LOCKGUARD_BACKUP_DRIVE_CLIENT_SECRET` от того же клиента, а также `LOCKGUARD_BACKUP_DRIVE_TOKEN` с JSON из поля `token` подключения. Контейнер `Dockerfile.web` содержит rclone. На собственном сервере установите rclone в PATH. Храните ключ шифрования отдельно от архивов.
4. Откройте «История проверок → Сохранность данных» и проверьте первую успешную выгрузку. Скачайте новый архив из Drive и выполните `npm run verify:restore -- --from <путь-к-архиву>`. При смене папки появится новый статус выгрузки.

Выгрузка копирует готовые зашифрованные архивы по расписанию `LOCKGUARD_BACKUP_HOURS`. Ошибка выгрузки оставляет локальную копию и запускает повтор через час работы сервиса. Спящий Railway не запускает таймеры. Просроченная выгрузка возобновляется после пробуждения. Для ежедневного срока восстановления настройте внешний ежедневный запрос к кабинету и проверьте фактическую дату копии. [Пробуждение Railway](https://docs.railway.com/deployments/serverless).

Для пилота храните в Drive копии за последние 14 дней и сохраняйте последнюю проверенную копию до следующей успешной проверки. Просматривайте папку раз в неделю, чтобы учитывать квоту Drive. Выгрузка добавляет файлы и сохраняет предыдущие архивы.

## Постоянный сервер

Бесплатный Render-стенд остаётся учебным. Его файловая система временная; резервная копия на том же стенде также может пропасть. Бесплатная Render Postgres ограничена сроком 30 дней и не является постоянным решением. [Ограничения Render](https://render.com/docs/free).

Для постоянного одиночного сервера подготовлен `npm run start:durable`. Нужны HTTPS-адрес, реально подключённый постоянный том, абсолютные `LOCKGUARD_DB_FILE` и `LOCKGUARD_BACKUP_DIR`, ключ резервирования и `LOCKGUARD_DURABLE_STORAGE=true`. Перед открытием порта выполняется проверка зашифрованного восстановления. Флаг — декларация оператора, не автоматическое доказательство свойств хостинга. Копии необходимо переносить на независимое защищённое хранилище. Подключение внешнего хранилища и почты требует аккаунтов и серверных секретов; оно не происходит от добавления переменных в `.env.example`.

Служебная готовность сервера доступна только владельцу через `/api/v1/operations`.

## English

Owners can inspect backup status, last attempt and last verified success under Review history → Data recovery readiness. Failures persist as a safe status without exception text, paths or keys. A verified successful retry clears the current failure while retaining its historical time. Failed or overdue backup evidence does not establish operational readiness. This local diagnostic does not replace external monitoring, notifications or off-host storage.

The scheduler uses `LOCKGUARD_BACKUP_HOURS` (default 24, range 1–8760 hours) and `LOCKGUARD_BACKUP_RETENTION` (default 7, range 1–100 files). Restarting preserves the deadline based on the last successful backup. Missing, overdue, invalid or future timestamps, or a failed last attempt, trigger an immediate backup. Subsequent attempts wait the configured interval after the current attempt finishes, including failure; attempts do not overlap. Stopping the scheduler cancels future attempts without interrupting a copy already in progress.

Pro adds invited organization members (owner, editor, reviewer), private migration review cards, independent approval, attestations, time-limited owner waivers and an audit trail. Invitations are one-use, email-bound and expire after 48 hours. Creating and accepting invitations requires verified email ownership. Request a verification email in account settings, open the one-use link within 30 minutes, sign in to the same account and explicitly confirm. Opening a link does not consume it. Resending or changing the password revokes pending links. When mail delivery is not configured, invitations remain unavailable while normal SQL analysis works. Membership does not replace the user's personal workspace. All review URLs require authenticated organization membership. Saving complete SQL is an explicit choice checked against the analyzed SQL hash. Approval is a team decision, not a safety guarantee. No notification emails are sent automatically to teammates.

Revoking a member blocks subsequent server access. On its next action, a stale tab clears the former cards and schemas and refreshes the selected workspace. Previously downloaded files cannot be recalled. Delayed errors from a former login or workspace do not reset the newer account state.

Create an offline recovery code in your account settings after confirming the current password. Store it in a password manager; it expires after one year and replaces the previous code. Use `reset.html` with the account email to change the password. All browser sessions and recovery codes are revoked. Email verification and email recovery need a configured Resend API key, verified sender and HTTPS application origin. Email tokens expire after 30 minutes, are stored hashed and use a URL fragment removed immediately by the reset page. Tests do not send real email.

`npm run backup` creates a verified snapshot. With `LOCKGUARD_BACKUP_KEY` set to a separately retained 32-byte base64 key, backups are encrypted with AES-256-GCM. The plaintext snapshot is staged in a private temporary directory. Keep the backup destination separate from the system temporary directory and sync only completed `.sqlite3.enc` files. Restore authenticates `.enc` files before opening them as SQLite.

`npm run verify:restore` restores to a temporary database, compares record checksums and checks revocation of temporary credentials. Restore requires a new path on a filesystem that supports hard links. The completed database appears at that path after temporary credentials have been revoked. Existing SQLite files and journals block publication. After a forced stop, check for private `.lockguard-restore-*` directories beside the target because they may contain backup data. API keys retain their backed-up status and must be revoked separately if exposure is suspected.

Download a completed encrypted copy from independent storage to a private directory, provide the original backup key to the verification process, and run `npm run verify:restore -- --from "/secure/received/lockguard-backup.sqlite3.enc"`. The command authenticates the selected file, verifies the restored records and clears the temporary databases. It runs independently of the live database and its readiness status. The operator confirms where the file was stored.

Owners can see the restore status, last attempt, last successful drill and current failure under Data recovery readiness. A failed or incomplete attempt, or success older than seven days, prevents operational readiness despite an earlier success. Success is recorded only after temporary data cleanup. A full successful retry clears the current failure while retaining its historical time. Status survives restart, and CLI failures omit original exceptions with paths or secrets. After a cleanup failure, inspect temporary storage before retrying; a failed status does not confirm data removal. This diagnostic does not replace independent off-host recovery verification.

The free Render demo remains ephemeral. Do not rely on its local backups for persistence. `npm run start:durable` requires an operator-provided persistent volume, absolute database and backup paths, an encryption key, HTTPS origin and `LOCKGUARD_DURABLE_STORAGE=true`; it performs a restore drill before listening. A configuration flag does not provision storage or prove durability. Keep an off-host copy. Permanent hosting, sender configuration and external backup storage still require infrastructure setup. No private records or credentials belong in Git.
