# Ревью, восстановление и хранение

[English](#english) · [Русский](#ревью-восстановление-и-хранение)

## Совместная работа в Pro

В серверном кабинете откройте историю проверок. Владелец создаёт приглашение для конкретного email с ролью редактора или рецензента. Код показывается один раз, действует 48 часов и принимается вошедшим пользователем с указанным адресом. Передавайте его лично. Регистрация пока не проверяет владение email: владелец должен самостоятельно убедиться, что код получил нужный человек.

| Роль | Возможности |
| --- | --- |
| Владелец | Настройки организации, ключи и участники, схемы, изменения, временные исключения |
| Редактор | Анализ и сохранение проверок, схемы, карточки и подтверждения |
| Рецензент | Чтение организации, комментарии, запрос изменений и независимое согласование |

Участник сохраняет личную организацию и переключается между доступными пространствами. Смена пространства действует на сеанс; устаревшая вкладка не может записать данные, выдавая их за прежнюю организацию. Лимит Pro: 20 участников и 100 карточек.

Карточка фиксирует результат конкретной проверки, хеш SQL, версию и ревизию снимка схемы. Сохранение полного SQL в карточке — отдельный выбор; сервер сверяет его хеш с проверкой. Ссылка открывается только после входа участника организации. Публичной публикации SQL нет.

Автор не согласует собственное изменение. Для согласования нужны подтверждения актуальности контекста, backfill, совместимости приложения и проверки на тестовой базе. Высокие и критические замечания требуют устранения либо отдельного исключения владельца с причиной и сроком до 90 дней. Истечение исключения требует повторного рассмотрения. Согласование — решение команды, не гарантия отсутствия аварии. Уведомления коллегам автоматически не рассылаются.

После окончания Pro карточки можно читать и экспортировать; владелец может их удалить. Изменять карточки и приглашать новых участников без Pro нельзя. Существующие участники сохраняют чтение — при необходимости владелец отзывает доступ.

## Восстановление доступа

После входа откройте «Личный кабинет → Резервный код восстановления», подтвердите пароль и сохраните показанный код в менеджере паролей. Он действует год, показывается один раз и заменяет предыдущий. На `reset.html` укажите email, код и новый пароль. Код одноразовый; смена пароля отзывает прежние сеансы и все коды восстановления.

Почтовое восстановление дополнительно требует переменных окружения `LOCKGUARD_MAIL_API_KEY` и `LOCKGUARD_MAIL_FROM` для проверенного отправителя Resend, а также HTTPS `APP_URL`. Gmail-адрес сам по себе не даёт права отправлять от него через Resend. До настройки запрос письма сообщает о недоступности сервиса. Ключи не коммитьте и не отправляйте в чат. Реальные письма из тестов не отправляются. [API провайдера](https://resend.com/docs/api-reference/emails/send-email).

Ссылка восстановления хранит одноразовый токен во фрагменте URL, не в query; страница сразу удаляет фрагмент из адреса. Не помещайте токен в логи. Токены хранятся в БД только как SHA-256; почтовый код действует 30 минут.

## Проверяемые резервные копии

```sh
npm run backup
npm run verify:restore
```

`verify:restore` восстанавливает копию в отдельный временный каталог, сравнивает контрольные суммы записей и проверяет отзыв сеансов, приглашений и кодов. Он не заменяет основную БД. Последняя успешная проверка видна владельцу в истории, блок «Сохранность данных».

Для шифрования задайте `LOCKGUARD_BACKUP_KEY`: случайный ключ из 32 байт в base64, полученный в менеджере секретов. Копии используют AES-256-GCM с новым случайным IV. Ключ храните отдельно от копий; без него восстановление невозможно. При ошибке шифрования резервирование завершается ошибкой, не сохраняя незашифрованную резервную копию как запасной вариант. Ранее существовавшие незашифрованные копии автоматически не удаляются.

Восстановление принимает новый путь и не перезаписывает существующую базу:

```sh
node --env-file-if-exists=.env scripts/restore-db.js /secure/backup.sqlite3.enc /secure/restored.sqlite3
```

Восстановление возвращает сохранённые аккаунты, членство, схемы, проверки, карточки и заказы. Все прежние сеансы, приглашения и коды восстановления отзываются. Восстановленные API-ключи сохраняют прежнее состояние: если копия могла быть раскрыта, оператор должен отозвать ключи отдельно.

## Постоянный сервер

Бесплатный Render-стенд остаётся учебным. Его файловая система временная; резервная копия на том же стенде также может пропасть. Бесплатная Render Postgres ограничена сроком 30 дней и не является постоянным решением. [Ограничения Render](https://render.com/docs/free).

Для постоянного одиночного сервера подготовлен `npm run start:durable`. Нужны HTTPS-адрес, реально подключённый постоянный том, абсолютные `LOCKGUARD_DB_FILE` и `LOCKGUARD_BACKUP_DIR`, ключ резервирования и `LOCKGUARD_DURABLE_STORAGE=true`. Перед открытием порта выполняется проверка зашифрованного восстановления. Флаг — декларация оператора, не автоматическое доказательство свойств хостинга. Копии необходимо переносить на независимое защищённое хранилище. Подключение внешнего хранилища и почты требует аккаунтов и серверных секретов; оно не происходит от добавления переменных в `.env.example`.

Служебная готовность сервера доступна только владельцу через `/api/v1/operations`.

## English

Pro adds invited organization members (owner, editor, reviewer), private migration review cards, independent approval, attestations, time-limited owner waivers and an audit trail. Invitations are one-use, email-bound and expire after 48 hours. Registration does not yet verify email ownership; deliver invitation codes privately to the intended person. Membership does not replace the user's personal workspace. All review URLs require authenticated organization membership. Saving complete SQL is an explicit choice checked against the analyzed SQL hash. Approval is a team decision, not a safety guarantee. No notification emails are sent automatically to teammates.

Create an offline recovery code in your account settings after confirming the current password. Store it in a password manager; it expires after one year and replaces the previous code. Use `reset.html` with the account email to change the password. All browser sessions and recovery codes are revoked. Email recovery additionally needs a configured Resend API key, verified sender and HTTPS application origin. Email tokens expire after 30 minutes, are stored hashed and use a URL fragment removed immediately by the reset page. Tests do not send real email.

`npm run backup` creates a verified snapshot. With `LOCKGUARD_BACKUP_KEY` set to a separately retained 32-byte base64 key, backups are encrypted with AES-256-GCM. `npm run verify:restore` restores to a temporary database, compares record checksums and checks revocation of temporary credentials. The live database is not replaced. Restore always requires a new target path. API keys retain their backed-up status and must be revoked separately if exposure is suspected.

The free Render demo remains ephemeral. Do not rely on its local backups for persistence. `npm run start:durable` requires an operator-provided persistent volume, absolute database and backup paths, an encryption key, HTTPS origin and `LOCKGUARD_DURABLE_STORAGE=true`; it performs a restore drill before listening. A configuration flag does not provision storage or prove durability. Keep an off-host copy. Permanent hosting, sender configuration and external backup storage still require infrastructure setup. No private records or credentials belong in Git.
