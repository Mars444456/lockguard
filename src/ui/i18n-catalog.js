/* Russian source text and reviewed English UI translations. No remote translation service. */
window.LockGuardTranslations = [
  ["Браузерное демо сохраняет настройки языка. По кнопке «Сохранить проверку» в этом браузере сохраняются SQL, название, версия PostgreSQL и дата — до 20 записей. Без этого действия введённый SQL в историю не записывается. Экспорт проекта создаёт незашифрованный JSON-файл с текущим SQL и локальной историей; импорт выполняется локально после подтверждения. Результаты из файла не принимаются за проверенные: SQL анализируется заново. Локальную историю можно удалить на странице или очисткой данных сайта. Данные доступны пользователям того же профиля браузера; храните конфиденциальные файлы самостоятельно. Хостинг и внешние ресурсы могут получать IP-адрес и технические сведения для доставки страницы. Ссылки на GitHub, Telegram и платёжную страницу ведут на отдельные сервисы.","The browser demo saves language preferences. Save check stores SQL, name, PostgreSQL version and date in this browser, up to 20 entries. SQL is not added to history without that action. Project export creates an unencrypted JSON file containing the current SQL and local history; import runs locally after confirmation. Imported results are not trusted: SQL is analyzed again. Delete local history on the page or by clearing site data. People using the same browser profile can access it; keep confidential files private. Hosting and external resources may receive the IP address and technical details needed to deliver the page. GitHub, Telegram and payment links lead to separate services."],
  ["Подтвердите email в личном кабинете перед работой с приглашениями.","Verify your email in account settings before using invitations."],
  ["Ссылка подтверждения недействительна или истекла.","The verification link is invalid or expired."],
  ["Подтверждение почты пока недоступно: отправка писем не настроена. SQL-анализ доступен, приглашения временно закрыты.","Email verification is unavailable because email delivery is not configured. SQL analysis is available; invitations are temporarily unavailable."],
  ["Повторное письмо можно запросить через минуту.","You can request another email after one minute."],
  ["Лимит писем подтверждения достигнут. Повторите запрос завтра.","The verification email limit was reached. Try again tomorrow."],
  ["Отправка писем не настроена.","Email delivery is not configured."],
  ["Письмо не удалось передать почтовому сервису. Повторите попытку позже.","The email could not be submitted to the mail service. Try again later."],
  ["Есть замечания","Findings to review"],
  ["Покрытие проверок: все настроенные правила включены.","Check coverage: all configured rules enabled."],
  ["Покрытие проверок: есть исключённые проверки — требуется ручной разбор.","Check coverage: some checks were excluded — manual review required."],
["Обновить историю","Refresh history"],
["Есть исключённые проверки","Some checks were excluded"],
["Есть отключённые или подавленные проверки","Some checks are disabled or findings suppressed"],
["Выведено из SQL; время удержания и ожидания не измерено","Inferred from SQL; lock holding and waiting time were not measured"],
["SQL не исполняется. Время ожидания, длительность операций и потери требуют измерения на вашей базе.","SQL is not executed. Waiting time, operation duration and losses require measurement on your database."],
["Версия PostgreSQL:","PostgreSQL version:"],
["Статический анализ • без исполнения SQL","Static analysis • SQL was not executed"],
["Миграционный DDL-скрипт (PostgreSQL {0})","DDL migration script (PostgreSQL {0})"],
["Измерения:","Measurements:"],
["Длительность, ожидания и нагрузка не измерены","Duration, waiting time and workload were not measured"],
["Макс. блокировка из SQL","Maximum lock inferred from SQL"],
["Замечаний правил","Rule findings"],
["Покрытие проверок:","Check coverage:"],
["все настроенные правила включены","all configured rules enabled"],
["есть исключённые проверки — требуется ручной разбор","some checks were excluded — manual review required"],
["Проверки DDL к этому скрипту не применяются. SQL не исполнялся; строковые блокировки и ожидания не измерены.","DDL checks do not apply to this script. SQL was not executed; row locks and waiting time were not measured."],
["Для ревью нужна полная проверка нового формата без отключённых или подавленных правил.","Review requires a complete check in the current format without disabled or suppressed rules."],
["В скрипте найдены замечания правил. Определённая по SQL максимальная блокировка:","Rule findings were found. Maximum lock inferred from SQL:"],
[". Длительность зависит от схемы, нагрузки и границ транзакций; SQL не исполнялся, показатели производительности не рассчитывались.",". Duration depends on the schema, workload and transaction boundaries; SQL was not executed and performance metrics were not calculated."],
  ["Требуется роль владельца организации.","The organization owner role is required."],
  ["Доступ к организации отозван.","Organization access has been revoked."],
  ["Рабочее пространство изменилось. Обновите данные перед действием.","The workspace changed. Refresh before continuing."],
  ["Организация не найдена.","Organization not found."],
  ["Приглашение недействительно.","The invitation is invalid or expired."],
  ["Приглашение недействительно для этого аккаунта.","This invitation is invalid for this account."],
  ["Лимит участников достигнут.","The member limit has been reached."],
  ["Участник не найден.","Member not found."],
  ["Владельца нельзя удалить.","The owner cannot be removed."],
  ["Ревью не найдено.","Review not found."],
  ["Рецензент не создаёт изменения.","Reviewers cannot create changes."],
  ["Проверка не найдена.","Check not found."],
  ["Для ревью нужна полная проверка нового формата.","A complete check in the current format is required."],
  ["SQL отличается от выбранной проверки или превышает 256 КБ.","SQL differs from the selected check or exceeds 256 KB."],
  ["Ревью изменилось. Обновите карточку.","The review changed. Refresh the card."],
  ["Недостаточно прав.","Insufficient permissions."],
  ["Нужен независимый участник: автор не согласует собственное изменение.","An independent reviewer is required: authors cannot approve their own changes."],
  ["Отправьте на ревью и подтвердите все проверки.","Submit for review and complete all attestations."],
  ["Устраните высокие риски или оформите временное исключение с причиной.","Resolve high risks or record a temporary waiver with a reason."],
  ["Укажите основание согласования.","Provide the reason for approval."],
  ["Укажите причину исключения.","Provide the reason for the waiver."],
  ["Опишите необходимые изменения.","Describe the requested changes."],
  ["Почтовое восстановление пока не настроено. Используйте сохранённый резервный код.","Email recovery is not configured. Use your saved offline recovery code."],
  ["Код восстановления недействителен или истёк.","The recovery code is invalid or expired."],
  ["Интеграция в CI/CD:","CI/CD integration:"],
  ["Используйте проверенную версию анализатора, например","Use a verified analyzer version, for example"],
  [", и просмотрите результат проверки миграции.",", and review the migration check result."],
  ["-- Черновая рекомендация для ручной проверки:","-- Draft recommendation for manual review:"],
  ["Таймауты:","Timeouts:"],
  ["Подберите","Choose"],
  ["под нагрузку и обработку ошибок. Они не гарантируют отсутствие задержек.","for your workload and error handling. They do not guarantee the absence of delays."],
  ["Индексы:","Indexes:"],
  ["Для занятой таблицы рассмотрите","For a busy table, consider"],
  ["вне транзакционного блока и проверьте ограничения этого режима.","outside a transaction block and verify this mode's limitations."],
  ["Рабочий процесс команды: схемы, сравнение результатов и закрытое ревью с ролями и историей решений. Нужен серверный экземпляр LockGuard.","Team workflow: schemas, comparisons and private reviews with roles and decision history. Requires a LockGuard server instance."],
  ["ACCESS EXCLUSIVE: конфликт со всеми табличными режимами","ACCESS EXCLUSIVE: conflicts with every table lock mode"],
  ["Конфликтует со всеми табличными режимами блокировок, включая обычный SELECT. Ожидание DDL за долгой транзакцией может задержать последующие запросы. Длительность очереди и влияние на приложение зависят от транзакций, нагрузки, таймаутов и повторов; исчерпание пула и HTTP-ошибки не следуют из одного SQL.","Conflicts with all table lock modes, including ordinary SELECT. DDL waiting behind a long transaction can delay later queries. Queue length and application impact depend on transactions, traffic, timeouts and retries; one SQL statement alone does not establish pool exhaustion or HTTP errors."],
  ["Командное ревью изменений","Team migration review"],
  ["До 20 участников · 100 закрытых карточек","Up to 20 members · 100 private cards"],
  ["История согласования","Approval history"],
  ["Роли, подтверждения и временные исключения","Roles, attestations and expiring waivers"],
  ["До 10 схем, 1000 проверок, сравнение результатов и закрытое командное ревью с историей решений.","Up to 10 schemas, 1,000 checks, comparison and private team review with a decision history."],
  ["От 12 символов. После входа сохраните резервный код в менеджере паролей.","At least 12 characters. After signing in, save an offline recovery code in your password manager."],
  ["Восстановить доступ","Recover access"],
  ["Анализ неполный: время не оценено","Analysis incomplete: duration is not assessed"],
  ["Отсутствие замечаний не определяет время операции","No findings does not establish operation duration"],
  ["Не применимо","Not applicable"],
  ["Черновая рекомендация для ручной проверки:","Draft recommendation for manual review:"],
  [
    "Тестовый стенд: аккаунты, история и схемы могут сброситься при перезапуске. Используйте только учебные данные.",
    "Test environment: accounts, history and schemas may reset on restart. Use sample data only."
  ],
  [
    "LockGuard — проверка миграций PostgreSQL",
    "LockGuard — PostgreSQL migration review"
  ],
  [
    "Проверьте SQL-миграции PostgreSQL: риски блокировок, рекомендации и план изменений. Открытое ядро, CLI и GitHub Action.",
    "Review PostgreSQL migrations for locking risks, recommendations and change plans. Open-source core, CLI and GitHub Action."
  ],
  [
    "LockGuard — главная",
    "LockGuard — home"
  ],
  [
    "Проверка миграций PostgreSQL",
    "PostgreSQL migration review"
  ],
  [
    "Войти",
    "Sign in"
  ],
  [
    "Донат",
    "Donate"
  ],
  [
    "Разделы LockGuard",
    "LockGuard sections"
  ],
  [
    "SQL-проверка",
    "SQL review"
  ],
  [
    "Матрица блокировок",
    "Lock matrix"
  ],
  [
    "Тарифы",
    "Pricing"
  ],
  [
    "Пилот для команды",
    "Team pilot"
  ],
  [
    "Контакты",
    "Contact"
  ],
  [
    "ЛИЧНЫЙ КАБИНЕТ",
    "YOUR ACCOUNT"
  ],
  [
    "Закрыть окно входа",
    "Close sign-in dialog"
  ],
  [
    "Закрыть",
    "Close"
  ],
  [
    "Выберите кабинет LockGuard",
    "Choose a LockGuard workspace"
  ],
  [
    "Проверка SQL работает на этом сайте без регистрации. Постоянный кабинет для рабочих данных ещё не размещён. Локальное приложение доступно на вашем компьютере.",
    "SQL review works on this site without an account. A permanent workspace for production data is not hosted yet. The local application runs on your computer."
  ],
  [
    "Онлайн-кабинет для тестирования",
    "Online test workspace"
  ],
  [
    "Аккаунты, история и схемы могут сброситься при перезапуске. Используйте только учебные данные. После простоя первый запуск может занять около минуты.",
    "Accounts, history and schemas may reset on restart. Use sample data only. The first request after inactivity may take about a minute."
  ],
  [
    "Открыть тестовый кабинет ↗",
    "Open test workspace ↗"
  ],
  [
    "LockGuard запущен на этом компьютере?",
    "Running LockGuard on this computer?"
  ],
  [
    "Перейдите в локальный кабинет, чтобы войти или зарегистрироваться. Ссылка работает только на компьютере, где запущено приложение.",
    "Open the local workspace to sign in or register. This link only works on the computer running the application."
  ],
  [
    "Открыть локальный кабинет",
    "Open local workspace"
  ],
  [
    "Как запустить LockGuard",
    "How to run LockGuard"
  ],
  [
    "Продолжить проверку без входа",
    "Continue reviewing without signing in"
  ],
  [
    "ОТКРЫТЫЙ ИНСТРУМЕНТ / POSTGRESQL",
    "OPEN-SOURCE TOOL / POSTGRESQL"
  ],
  [
    "Изменения схемы —",
    "Schema changes —"
  ],
  [
    "под контролем.",
    "under control."
  ],
  [
    "Проверьте миграцию до релиза. Найдите риски блокировок, разберите замечания и подготовьте план изменений.",
    "Review a migration before release. Find locking risks, understand findings and prepare a change plan."
  ],
  [
    "Открыть редактор SQL",
    "Open SQL editor"
  ],
  [
    "Подключить к CI",
    "Connect to CI"
  ],
  [
    "12 правил анализа",
    "12 analysis rules"
  ],
  [
    "Без регистрации",
    "No account required"
  ],
  [
    "SQL остаётся в браузере",
    "SQL stays in your browser"
  ],
  [
    "ПРИМЕР ПРОВЕРКИ",
    "REVIEW EXAMPLE"
  ],
  [
    "LG-002 · Блокировка записи",
    "LG-002 · Writes blocked"
  ],
  [
    "РЕКОМЕНДАЦИЯ ДЛЯ ПРОВЕРКИ",
    "RECOMMENDATION TO REVIEW"
  ],
  [
    "AST-анализ",
    "AST analysis"
  ],
  [
    "замечания",
    "findings"
  ],
  [
    "осознанный релиз",
    "informed release"
  ],
  [
    "Быстрый доступ",
    "Quick access"
  ],
  [
    "БЫСТРЫЙ ДОСТУП",
    "QUICK ACCESS"
  ],
  [
    "Редактор SQL",
    "SQL editor"
  ],
  [
    "CLI и документация",
    "CLI and documentation"
  ],
  [
    "Telegram-бот",
    "Telegram bot"
  ],
  [
    "Параметры проверки",
    "Review settings"
  ],
  [
    "Готовый сценарий:",
    "Example migration:"
  ],
  [
    "Несколько рисков в одной миграции",
    "Multiple risks in one migration"
  ],
  [
    "DEFAULT с вычислением · LG-001",
    "Computed DEFAULT · LG-001"
  ],
  [
    "CREATE INDEX без CONCURRENTLY · LG-002",
    "CREATE INDEX without CONCURRENTLY · LG-002"
  ],
  [
    "Внешний ключ без NOT VALID · LG-003",
    "Foreign key without NOT VALID · LG-003"
  ],
  [
    "Изменение типа столбца · LG-004",
    "Column type change · LG-004"
  ],
  [
    "Прямое ограничение UNIQUE · LG-005",
    "Direct UNIQUE constraint · LG-005"
  ],
  [
    "Удаление столбца · LG-006",
    "Column removal · LG-006"
  ],
  [
    "Не задан lock_timeout · LG-008",
    "Missing lock_timeout · LG-008"
  ],
  [
    "🚫 Опасный ALTER COLUMN SET NOT NULL (LG-009)",
    "🚫 Unsafe ALTER COLUMN SET NOT NULL (LG-009)"
  ],
  [
    "⛔ CONCURRENTLY внутри транзакции (LG-010)",
    "⛔ CONCURRENTLY inside a transaction (LG-010)"
  ],
  [
    "Внешний ключ без индекса · LG-011",
    "Foreign key without an index · LG-011"
  ],
  [
    "TRUNCATE и REFRESH MATVIEW · LG-012",
    "TRUNCATE and REFRESH MATVIEW · LG-012"
  ],
  [
    "Пример без выявленных нарушений",
    "Example with no known rule violations"
  ],
  [
    "Версия / Форк PostgreSQL:",
    "PostgreSQL version / fork:"
  ],
  [
    "Postgres Pro · модель",
    "Postgres Pro · model"
  ],
  [
    "Citus · модель",
    "Citus · model"
  ],
  [
    "PostgreSQL 10 и старше",
    "PostgreSQL 10 and earlier"
  ],
  [
    "Параметры оценки нагрузки",
    "Load model settings"
  ],
  [
    "Не измерения: модель по заданным условиям",
    "A model using your inputs, not measurements"
  ],
  [
    "📊 Размер боевой таблицы в базе:",
    "📊 Production table size:"
  ],
  [
    "14.2M строк (~8.4 GB)",
    "14.2M rows (~8.4 GB)"
  ],
  [
    "⚡ Фоновый клиентский трафик (RPS):",
    "⚡ Background client traffic (RPS):"
  ],
  [
    "🛡️ Пул соединений PgBouncer (лимит одновременных коннектов):",
    "🛡️ PgBouncer connection pool (concurrent connections):"
  ],
  [
    "100 коннектов",
    "100 connections"
  ],
  [
    "💰 Дневной оборот проекта (GMV / выручка):",
    "💰 Daily project turnover (GMV / revenue):"
  ],
  [
    "1 000 000 ₽ / день",
    "1 000 000 ₽ / day"
  ],
  [
    "🖥️ Конфигурация сервера БД (vCPU Cores):",
    "🖥️ Database server configuration (vCPU cores):"
  ],
  [
    "Скопировать ссылку на этот запрос",
    "Copy a link to this query"
  ],
  [
    "🔗 Поделиться",
    "🔗 Share"
  ],
  [
    "План изменений",
    "Change plan"
  ],
  [
    "Очистить",
    "Clear"
  ],
  [
    "Проверить SQL",
    "Review SQL"
  ],
  [
    "Ctrl / ⌘ + Enter — проверить",
    "Ctrl / ⌘ + Enter to review"
  ],
  [
    "Результат проверки",
    "Review result"
  ],
  [
    "Ожидает проверки",
    "Ready to review"
  ],
  [
    "Открыть отчёт для печати или сохранения в PDF",
    "Open the report for printing or saving as PDF"
  ],
  [
    "Отчёт / PDF",
    "Report / PDF"
  ],
  [
    "Сначала проверим ваш SQL",
    "Let's review your SQL"
  ],
  [
    "Выберите пример или вставьте миграцию слева. Здесь появятся риски блокировок и рекомендации. SQL анализируется в браузере и не исполняется.",
    "Choose an example or paste a migration on the left. Locking risks and recommendations will appear here. SQL is analyzed in the browser and is not executed."
  ],
  [
    "ℹ️ DML ЗАПРОС ДАННЫХ (SELECT / INSERT / UPDATE):",
    "ℹ️ DML QUERY (SELECT / INSERT / UPDATE):"
  ],
  [
    "Блокировка по SQL",
    "Lock inferred from SQL"
  ],
  [
    "Замораживает всю таблицу",
    "Blocks the entire table"
  ],
  [
    "Замечания правил",
    "Rule findings"
  ],
  [
    "Результат проверки правил",
    "Rule check result"
  ],
  [
    "Оценочная модель нагрузки",
    "Load estimation model"
  ],
  [
    "Это условный сценарий по заданным параметрам. Числа не измерены на вашей базе и не являются прогнозом простоя или финансовых потерь.",
    "This is a hypothetical scenario using the selected inputs. These numbers were not measured on your database and do not predict downtime or financial loss."
  ],
  [
    "Оценка времени по модели",
    "Time estimated by the model"
  ],
  [
    "По заданному размеру таблицы",
    "Based on the selected table size"
  ],
  [
    "Ожидания запросов по модели",
    "Query waits estimated by the model"
  ],
  [
    "Условная нагрузка, не измерение",
    "Hypothetical load, not measurements"
  ],
  [
    "Насыщение пула по модели",
    "Pool saturation in the model"
  ],
  [
    "По заданному лимиту пула",
    "Based on the selected pool limit"
  ],
  [
    "Условная оценка потерь",
    "Hypothetical loss estimate"
  ],
  [
    "По заданному обороту",
    "Based on the selected turnover"
  ],
  [
    "Вероятность ожидания по модели",
    "Wait probability in the model"
  ],
  [
    "M/M/c модель очередей",
    "M/M/c queueing model"
  ],
  [
    "Матрица конфликта блокировок (Доступность операций)",
    "Lock conflict matrix (operation availability)"
  ],
  [
    "Черновой план изменений",
    "Draft change plan"
  ],
  [
    "Проверьте фазы на тестовой базе: выполнение и отсутствие простоев не гарантируются.",
    "Test the phases on a non-production database: successful execution and zero downtime are not guaranteed."
  ],
  [
    "📥 Скачать файл миграции",
    "📥 Download migration file"
  ],
  [
    "Замечания и рекомендации",
    "Findings and recommendations"
  ],
  [
    "Какие блокировки конфликтуют",
    "Which locks conflict?"
  ],
  [
    "Выберите режим блокировки: матрица покажет, какие параллельные операции будут ждать её завершения.",
    "Choose a lock mode to see which concurrent operations would wait for it to finish."
  ],
  [
    "Запрашиваемая ↓ / удерживаемая →",
    "Requested ↓ / held →"
  ],
  [
    "🚨 ACCESS EXCLUSIVE: Фатальная блокировка таблицы (Full Outage Risk)",
    "🚨 ACCESS EXCLUSIVE: Entire table blocked (full outage risk)"
  ],
  [
    "Блокирует",
    "Blocks"
  ],
  [
    "абсолютно все операции",
    "every operation"
  ],
  [
    ": чтение (",
    ": reads ("
  ],
  [
    "), запись (",
    "), writes ("
  ],
  [
    "), создание индексов и любые другие DDL/DML. Если в этот момент выполняется долгий аналитический запрос, DDL встает в очередь, а все последующие",
    "), index creation and other DDL/DML. If a long-running analytical query is active, DDL can queue behind it and subsequent"
  ],
  [
    "выстраиваются за ним (Head-of-Line Blocking), исчерпывая пул соединений и приводя к массовым ошибкам",
    "queries can queue behind that DDL (head-of-line blocking), exhausting the connection pool and causing"
  ],
  [
    "⛔ Блокирует: SELECT",
    "⛔ Blocks: SELECT"
  ],
  [
    "⛔ Блокирует: INSERT / UPDATE / DELETE",
    "⛔ Blocks: INSERT / UPDATE / DELETE"
  ],
  [
    "⛔ Блокирует: CREATE INDEX",
    "⛔ Blocks: CREATE INDEX"
  ],
  [
    "⛔ Блокирует: VACUUM",
    "⛔ Blocks: VACUUM"
  ],
  [
    "Услуги и стоимость",
    "Services and pricing"
  ],
  [
    "Бесплатный анализ, доступ Pro на 30 дней и разовый технический аудит. Автоматических списаний нет.",
    "Free analysis, 30-day Pro access and a one-off technical audit. No automatic renewals."
  ],
  [
    "Возможности",
    "Features"
  ],
  [
    "Все 12 правил и локальный CLI",
    "All 12 rules and local CLI"
  ],
  [
    "Да · MIT",
    "Yes · MIT"
  ],
  [
    "Да",
    "Yes"
  ],
  [
    "История в серверном кабинете",
    "History in the server workspace"
  ],
  [
    "100 последних проверок",
    "100 most recent reviews"
  ],
  [
    "1000 последних проверок",
    "1,000 most recent reviews"
  ],
  [
    "Сохранённые схемы организации",
    "Saved organization schemas"
  ],
  [
    "До 10 · SQL / JSON",
    "Up to 10 · SQL / JSON"
  ],
  [
    "Анализ с сохранённой схемой",
    "Analysis with a saved schema"
  ],
  [
    "Кабинет и API-ключ",
    "Workspace and API key"
  ],
  [
    "Сравнение замечаний до / после",
    "Before / after comparison"
  ],
  [
    "Новые, устранённые, оставшиеся",
    "Introduced, resolved, persisting"
  ],
  [
    "/ без оплаты",
    "/ free"
  ],
  [
    "Открытое ядро и браузерная демонстрация анализа SQL.",
    "Open-source core and browser SQL analysis demo."
  ],
  [
    "Анализ SQL в браузере",
    "SQL analysis in your browser"
  ],
  [
    "Каталог правил блокировок PostgreSQL",
    "PostgreSQL locking rule catalog"
  ],
  [
    "Открытый исходный код и локальный CLI",
    "Open source and local CLI"
  ],
  [
    "Открыть бесплатный анализ",
    "Open free analysis"
  ],
  [
    "ДОСТУП НА 30 ДНЕЙ",
    "30-DAY ACCESS"
  ],
  [
    "/ 30 дней",
    "/ 30 days"
  ],
  [
    "Рабочий процесс команды: сохранённые схемы, глубокая история и сравнение результатов. Нужен серверный экземпляр LockGuard.",
    "A team workflow with saved schemas, longer history and result comparison. Requires a LockGuard server instance."
  ],
  [
    "До 10 схем организации · SQL / JSON",
    "Up to 10 organization schemas · SQL / JSON"
  ],
  [
    "Анализ с учётом существующих индексов и ограничений",
    "Analysis using existing indexes and constraints"
  ],
  [
    "До 1000 последних проверок",
    "Up to 1,000 most recent reviews"
  ],
  [
    "Сравнение новых, устранённых и оставшихся замечаний",
    "Compare introduced, resolved and persisting findings"
  ],
  [
    "30 дней · поддержка по email · без автосписаний",
    "30 days · email support · no automatic renewals"
  ],
  [
    "Адрес экземпляра подтверждается до оплаты",
    "Instance address confirmed before payment"
  ],
  [
    "Условия и заказ Pro",
    "Pro terms and ordering"
  ],
  [
    "Порядок отказа и возврата",
    "Cancellation and refunds"
  ],
  [
    "Аудит SQL-миграций",
    "SQL migration audit"
  ],
  [
    "/ разовый заказ",
    "/ one-off order"
  ],
  [
    "Техническая проверка согласованного набора миграций PostgreSQL.",
    "Technical review of an agreed set of PostgreSQL migrations."
  ],
  [
    "Объём, материалы и срок согласуются письменно до оплаты",
    "Scope, materials and schedule agreed in writing before payment"
  ],
  [
    "Электронный отчёт о выявленных рисках",
    "Electronic report of identified risks"
  ],
  [
    "Рекомендации по изменению миграций",
    "Recommendations for migration changes"
  ],
  [
    "Внедрение и дополнительные работы согласуются отдельно",
    "Implementation and extra work agreed separately"
  ],
  [
    "Согласовать аудит",
    "Discuss an audit"
  ],
  [
    "Оплата и получение услуги",
    "Payment and delivery"
  ],
  [
    "Онлайн-оплата через Robokassa находится на этапе подключения. Перед оплатой согласуйте заказ через",
    "Online payment through Robokassa is being connected. Before paying, agree on an order through the"
  ],
  [
    "контакты исполнителя",
    "service provider's contacts"
  ],
  [
    ". Платёжная ссылка предоставляется для согласованного заказа после подключения магазина.",
    ". A payment link is provided for the agreed order after the merchant account is connected."
  ],
  [
    "Расчёты — в рублях. При подключённом магазине способы оплаты выбираются на защищённой странице Robokassa. Данные карты на сайте LockGuard не вводятся. Чек предоставляется самозанятым в установленном порядке; автоматическая выдача зависит от подключения сервиса чеков.",
    "Payments are in rubles. Once the merchant account is connected, payment methods are selected on Robokassa's secure page. Card details are not entered on LockGuard. A self-employed receipt is provided as required; automatic issuance depends on the receipt service connection."
  ],
  [
    "Доставка только электронная: доступ к сервису или отчёт по согласованному каналу. Доступ Pro предоставляется после подтверждения платежа, аудит — в срок, согласованный в заказе. Если услуга не оказана, обратитесь за возвратом; подробнее —",
    "Delivery is electronic only: service access or a report through the agreed channel. Pro access follows payment confirmation; audit delivery follows the agreed schedule. If the service is not provided, request a refund; see the"
  ],
  [
    "условия отказа и возврата",
    "cancellation and refund terms"
  ],
  [
    "Статический анализ не гарантирует отсутствие всех дефектов и простоев. Перед применением миграции необходима проверка на тестовой базе.",
    "Static analysis cannot guarantee detection of every defect or the absence of downtime. Test migrations on a non-production database before applying them."
  ],
  [
    "Контакты и реквизиты",
    "Contact and provider details"
  ],
  [
    "Публичная оферта",
    "Public offer"
  ],
  [
    "Конфиденциальность",
    "Privacy"
  ],
  [
    "ДЛЯ КОМАНД НА POSTGRESQL",
    "FOR POSTGRESQL TEAMS"
  ],
  [
    "Проверьте LockGuard на своих миграциях",
    "Try LockGuard on your migrations"
  ],
  [
    "Обсудим пилот на 1–3 SQL-миграциях: какие риски видит анализатор, какие замечания полезны и как встроить проверку в ваш CI.",
    "Discuss a pilot on 1–3 SQL migrations: the risks the analyzer identifies, which findings are useful and how a check could fit your CI."
  ],
  [
    "Первые 10 минут: пример до / после и подключение к CI →",
    "Your first 10 minutes: before / after example and CI setup →"
  ],
  [
    "Обсудить пилот",
    "Discuss a pilot"
  ],
  [
    "Для первого знакомства достаточно описания процесса. Объём и условия пилота согласуем до начала работы.",
    "Start by describing your workflow. Pilot scope and terms are agreed before work begins."
  ],
  [
    "Ваш процесс",
    "Your workflow"
  ],
  [
    "Версия PostgreSQL, Prisma / Drizzle / SQL и способ выпуска миграций.",
    "PostgreSQL version, Prisma / Drizzle / SQL and your migration release process."
  ],
  [
    "Понятный результат",
    "A clear result"
  ],
  [
    "Замечания по блокировкам и рекомендации для проверки на тестовой базе.",
    "Locking findings and recommendations to test on a non-production database."
  ],
  [
    "Без доступа к рабочей БД",
    "No production database access"
  ],
  [
    "SQL можно обезличить. Пароли, ключи и данные пользователей не нужны.",
    "SQL can be sanitized. Passwords, keys and user records are not needed."
  ],
  [
    "ОТКРЫТЫЙ ПРОЕКТ",
    "OPEN-SOURCE PROJECT"
  ],
  [
    "Поддержать развитие LockGuard",
    "Support LockGuard development"
  ],
  [
    "Если инструмент помогает вам в работе, можно поддержать автора разовым донатом через DonationAlerts.",
    "If the tool helps your work, you can support its development with a one-off donation through DonationAlerts."
  ],
  [
    "Добровольная поддержка автора. Доступ Pro оформляется отдельно.",
    "Voluntary support for the project. Pro access is purchased separately."
  ],
  [
    "Поддержать на DonationAlerts",
    "Support on DonationAlerts"
  ],
  [
    "Оферта и возвраты",
    "Offer and refunds"
  ],
  [
    "Регистрация",
    "Register"
  ],
  [
    "Выйти",
    "Sign out"
  ],
  [
    "Администратор",
    "Administrator"
  ],
  [
    "Гость",
    "Guest"
  ],
  [
    "Разделы приложения",
    "Application sections"
  ],
  [
    "История проверок",
    "Review history"
  ],
  [
    "Ключи API",
    "API keys"
  ],
  [
    "Схемы",
    "Schemas"
  ],
  [
    "Правила",
    "Rules"
  ],
  [
    "Открыта копия файла.",
    "You opened a file copy."
  ],
  [
    "Для входа и анализа запустите",
    "To sign in and analyze, run"
  ],
  [
    "и откройте",
    "and open"
  ],
  [
    "Браузерное демо без сервера →",
    "Server-free browser demo →"
  ],
  [
    "ВАШЕ ПРОСТРАНСТВО",
    "YOUR WORKSPACE"
  ],
  [
    "Проверки и ключи.",
    "Reviews and keys."
  ],
  [
    "В одном месте.",
    "In one place."
  ],
  [
    "У каждой организации своя история, настройки и ключи API.",
    "Each organization has its own history, settings and API keys."
  ],
  [
    "Как хранятся данные →",
    "How data is stored →"
  ],
  [
    "Личный кабинет",
    "Your account"
  ],
  [
    "Закрыть личный кабинет",
    "Close account panel"
  ],
  [
    "Войдите, чтобы сохранять проверки и управлять ключами API своей организации.",
    "Sign in to save reviews and manage your organization's API keys."
  ],
  [
    "Вход",
    "Sign in"
  ],
  [
    "Название организации",
    "Organization name"
  ],
  [
    "Команда или название проекта",
    "Team or project name"
  ],
  [
    "Пароль",
    "Password"
  ],
  [
    "Не менее 12 символов",
    "At least 12 characters"
  ],
  [
    "От 12 символов. Сохраните пароль: восстановление по email пока не подключено.",
    "At least 12 characters. Save your password: email recovery is not connected yet."
  ],
  [
    "Сохранить название",
    "Save name"
  ],
  [
    "Сменить пароль",
    "Change password"
  ],
  [
    "Текущий пароль",
    "Current password"
  ],
  [
    "Новый пароль",
    "New password"
  ],
  [
    "РАБОЧЕЕ ПРОСТРАНСТВО",
    "WORKSPACE"
  ],
  [
    "Проверьте миграцию.",
    "Review your migration."
  ],
  [
    "Подготовьте спокойный релиз.",
    "Prepare for release."
  ],
  [
    "Найдите риски блокировок до запуска SQL. Изучите замечания и подготовьте изменения к проверке на тестовой базе.",
    "Find locking risks before running SQL. Understand findings and prepare changes to test on a non-production database."
  ],
  [
    "Настоящий PostgreSQL AST",
    "Real PostgreSQL AST"
  ],
  [
    "SQL не исполняется",
    "SQL is not executed"
  ],
  [
    "ПЕРЕД РЕЛИЗОМ",
    "BEFORE RELEASE"
  ],
  [
    "Вставьте SQL или выберите пример",
    "Paste SQL or choose an example"
  ],
  [
    "Проверьте блокировки и замечания",
    "Review locks and findings"
  ],
  [
    "Проверьте рекомендации на тестовой базе",
    "Test recommendations on a non-production database"
  ],
  [
    "Документация",
    "Documentation"
  ],
  [
    "Пример миграции",
    "Example migration"
  ],
  [
    "PRO · сохранённые схемы",
    "PRO · saved schemas"
  ],
  [
    "Без сохранённой схемы",
    "Without a saved schema"
  ],
  [
    "Управлять схемами ↗",
    "Manage schemas ↗"
  ],
  [
    "Контекст примера: 14,2 млн строк",
    "Example context: 14.2 million rows"
  ],
  [
    "Выберите пример или вставьте миграцию слева. Здесь появятся риски блокировок и рекомендации.",
    "Choose an example or paste a migration on the left. Locking risks and recommendations will appear here."
  ],
  [
    "Максимальная блокировка",
    "Highest lock level"
  ],
  [
    "Нарушения правил",
    "Rule violations"
  ],
  [
    "Затронутые таблицы",
    "Affected tables"
  ],
  [
    "Отчёт для Pull Request",
    "Pull request report"
  ],
  [
    "Скопировать отчёт",
    "Copy report"
  ],
  [
    "Результаты SQL-проверок вашей организации. Демонстрационная проверка PR отмечается отдельно.",
    "Your organization's SQL review results. Demo PR checks are marked separately."
  ],
  [
    "Проверить тестовый PR",
    "Review a test PR"
  ],
  [
    "Что изменилось после исправления",
    "What changed after the revision?"
  ],
  [
    "Pro сравнивает две проверки: новые замечания, устранённые и оставшиеся. Нужны результаты новых полных анализов.",
    "Pro compares two reviews: introduced, resolved and persisting findings. Requires recent, complete analysis results."
  ],
  [
    "До",
    "Before"
  ],
  [
    "После",
    "After"
  ],
  [
    "Сравнить проверки",
    "Compare reviews"
  ],
  [
    "Статус",
    "Status"
  ],
  [
    "Проверка / репозиторий",
    "Review / repository"
  ],
  [
    "Ветка / коммит",
    "Branch / commit"
  ],
  [
    "Блокировка",
    "Lock"
  ],
  [
    "Замечания",
    "Findings"
  ],
  [
    "Время",
    "Time"
  ],
  [
    "Отчёт",
    "Report"
  ],
  [
    "Сохранённый отчёт",
    "Saved report"
  ],
  [
    "Отчёт проверки",
    "Review report"
  ],
  [
    "Ключи вашей организации для серверного API. Храните секреты в переменных окружения или секретах CI.",
    "Your organization's keys for the server API. Store secrets in environment variables or CI secrets."
  ],
  [
    "+ Создать ключ",
    "+ Create key"
  ],
  [
    "Название",
    "Name"
  ],
  [
    "Ключ API",
    "API key"
  ],
  [
    "Создан",
    "Created"
  ],
  [
    "Использован",
    "Last used"
  ],
  [
    "Действия",
    "Actions"
  ],
  [
    "Подключение к CI",
    "CI integration"
  ],
  [
    "Для серверного анализа сохраните ключ как",
    "For server analysis, save the key as"
  ],
  [
    ", а адрес вашего сервера — как",
    "and your server address as"
  ],
  [
    ". Настройте их использование в workflow.",
    ". Configure them in your workflow."
  ],
  [
    "Открытый CLI и GitHub Action работают локально без ключа.",
    "The open-source CLI and GitHub Action run locally without a key."
  ],
  [
    "Инструкция по подключению →",
    "Setup guide →"
  ],
  [
    "КОНТЕКСТ ВАШЕГО ПРОЕКТА",
    "YOUR PROJECT CONTEXT"
  ],
  [
    "Анализ с учётом схемы.",
    "Schema-aware analysis."
  ],
  [
    "Сохраните структуру таблиц и индексов. LockGuard учтёт существующие индексы и подтверждённые ограничения при следующих проверках.",
    "Save table and index structure. LockGuard will use existing indexes and confirmed constraints in subsequent reviews."
  ],
  [
    "Один раз загрузите схему.",
    "Upload your schema once."
  ],
  [
    "Используйте в каждом релизе.",
    "Use it in every release."
  ],
  [
    "До 10 схем организации, 1000 последних проверок и сравнение замечаний до и после исправления.",
    "Up to 10 organization schemas, 1,000 most recent reviews and before / after comparison."
  ],
  [
    "Бесплатный анализ и все 12 правил остаются доступны в Community.",
    "Free analysis and all 12 rules remain available in Community."
  ],
  [
    "Посмотреть возможности Pro →",
    "Explore Pro features →"
  ],
  [
    "Онлайн-оплата подключается. Платный доступ активирует сервер.",
    "Online payment is being connected. Paid access is activated by the server."
  ],
  [
    "Pro активен. Схемы доступны только вашей организации. Снимок следует обновлять после изменений базы.",
    "Pro is active. Schemas are private to your organization. Update snapshots after database changes."
  ],
  [
    "Добавить снимок структуры",
    "Add a structure snapshot"
  ],
  [
    "Только описание схемы, без строк данных. SQL не выполняется. Сохраняется нормализованная структура, а не исходный файл.",
    "Schema description only, without data rows. SQL is not executed. The normalized structure is saved, not the original file."
  ],
  [
    "Название снимка",
    "Snapshot name"
  ],
  [
    "Например, production · октябрь",
    "For example, production · October"
  ],
  [
    "Версия PostgreSQL",
    "PostgreSQL version"
  ],
  [
    "Схема по умолчанию",
    "Default schema"
  ],
  [
    "Файл структуры · SQL или JSON · до 512 КБ",
    "Structure file · SQL or JSON · up to 512 KB"
  ],
  [
    "Структура схемы",
    "Schema structure"
  ],
  [
    "SQL: CREATE TABLE, CREATE INDEX, добавление ограничений. Полный pg_dump с функциями, данными или search_path не принимается. JSON: формат LockGuard v1. При неполном или устаревшем снимке результаты требуют дополнительной проверки.",
    "SQL: CREATE TABLE, CREATE INDEX and added constraints. Full pg_dump files containing functions, data or search_path are not accepted. JSON: LockGuard v1 format. Incomplete or outdated snapshots require additional review."
  ],
  [
    "Сохранить схему",
    "Save schema"
  ],
  [
    "Схемы организации",
    "Organization schemas"
  ],
  [
    "Обновить",
    "Refresh"
  ],
  [
    "Экспорт и удаление своих схем доступны и после окончания Pro.",
    "You can export and delete your schemas after Pro expires."
  ],
  [
    "Правила анализа",
    "Analysis rules"
  ],
  [
    "12 правил проверки миграций PostgreSQL. Неизвестные конструкции дополнительно блокируются правилом LG-000.",
    "12 PostgreSQL migration rules. Unknown constructs are additionally blocked by LG-000."
  ],
  [
    "Выберите подходящий формат",
    "Choose the right option"
  ],
  [
    "Бесплатное ядро, доступ Pro и технический аудит. Онлайн-оплата пока подключается.",
    "Free core, Pro access and technical audits. Online payment is being connected."
  ],
  [
    "До оплаты ознакомьтесь с",
    "Before paying, read the"
  ],
  [
    "офертой и правилами возврата",
    "offer and refund terms"
  ],
  [
    "и",
    "and"
  ],
  [
    "реквизитами исполнителя",
    "provider details"
  ],
  [
    "ОТКРЫТОЕ ЯДРО",
    "OPEN-SOURCE CORE"
  ],
  [
    "/ бесплатно",
    "/ free"
  ],
  [
    "Для локального анализа, обучения и собственных проектов.",
    "For local analysis, learning and your own projects."
  ],
  [
    "Анализ SQL и 12 правил блокировок",
    "SQL analysis and 12 locking rules"
  ],
  [
    "Локальный CLI без лимита проверок",
    "Local CLI with unlimited reviews"
  ],
  [
    "Открытый код и GitHub Action",
    "Open source and GitHub Action"
  ],
  [
    "100 последних проверок в личном кабинете",
    "100 most recent reviews in your account"
  ],
  [
    "НА 30 ДНЕЙ",
    "FOR 30 DAYS"
  ],
  [
    "Доступ к согласованному экземпляру LockGuard и поддержка по его использованию. Возможности и адрес подтверждаются до оплаты.",
    "Access to an agreed LockGuard instance and support using it. Features and instance address are confirmed before payment."
  ],
  [
    "До 10 сохранённых схем организации",
    "Up to 10 saved organization schemas"
  ],
  [
    "Сравнение: новые, устранённые и оставшиеся замечания",
    "Compare introduced, resolved and persisting findings"
  ],
  [
    "Экспорт нормализованной схемы в JSON",
    "Export normalized schemas as JSON"
  ],
  [
    "Поддержка по email · без автосписаний",
    "Email support · no automatic renewals"
  ],
  [
    "Подключение оплаты",
    "Payment setup"
  ],
  [
    "ТЕХНИЧЕСКИЙ АУДИТ",
    "TECHNICAL AUDIT"
  ],
  [
    "Разовый персональный аудит. Материалы, объём и срок выполнения согласуются письменно до оплаты.",
    "A one-off individual audit. Materials, scope and delivery schedule are agreed in writing before payment."
  ],
  [
    "Проверка согласованного набора SQL и схемы",
    "Review of agreed SQL files and schema"
  ],
  [
    "Анализ индексов, внешних ключей и рисков блокировок",
    "Review of indexes, foreign keys and locking risks"
  ],
  [
    "✔ Дополнительные работы согласуются отдельно",
    "✔ Extra work agreed separately"
  ],
  [
    "✔ Рекомендации по порядку применения миграций",
    "✔ Recommendations on migration order"
  ],
  [
    "✔ Формат консультации согласуется до оплаты",
    "✔ Consultation format agreed before payment"
  ],
  [
    "✔ Электронный отчёт и чек самозанятого",
    "✔ Electronic report and self-employed receipt"
  ],
  [
    "Обсудить аудит",
    "Discuss an audit"
  ],
  [
    "Ссылка для оплаты созданного заказа",
    "Payment link for the created order"
  ],
  [
    "Ссылка на оплату",
    "Payment link"
  ],
  [
    "Если платёжная страница не открылась, скопируйте ссылку. Тестовые заказы не включают рабочий доступ.",
    "If the payment page did not open, copy the link. Test orders do not activate production access."
  ],
  [
    "Обновить статус заказов",
    "Refresh order status"
  ],
  [
    "Попробуйте LockGuard на воспроизводимом примере PostgreSQL-миграции. Разберите риски, пользу снимка схемы и подключение к Prisma, Drizzle и CI.",
    "Try LockGuard on a reproducible PostgreSQL migration example. Explore risks, schema context and integration with Prisma, Drizzle and CI."
  ],
  [
    "Первые 10 минут с LockGuard",
    "Your first 10 minutes with LockGuard"
  ],
  [
    "Навигация",
    "Navigation"
  ],
  [
    "Пример",
    "Example"
  ],
  [
    "Подключение",
    "Integration"
  ],
  [
    "Обсудить пилот ↗",
    "Discuss a pilot ↗"
  ],
  [
    "ОТ ПЕРВОЙ ПРОВЕРКИ ДО ВАШЕГО CI",
    "FROM YOUR FIRST REVIEW TO CI"
  ],
  [
    "Одна миграция.",
    "One migration."
  ],
  [
    "Понятный следующий шаг.",
    "A clear next step."
  ],
  [
    "Посмотрите, какой риск находит LockGuard, что меняет снимок схемы и как проверить собственный SQL до релиза.",
    "See the risk LockGuard finds, how a schema snapshot changes findings and how to review your own SQL before release."
  ],
  [
    "Разобрать пример ↓",
    "Explore the example ↓"
  ],
  [
    "Предложить свою миграцию ↗",
    "Suggest your migration ↗"
  ],
  [
    "Без регистрации · без подключения к вашей БД · открытое ядро MIT",
    "No account · no database connection · MIT open-source core"
  ],
  [
    "01 / ВОСПРОИЗВОДИМЫЙ ПРИМЕР",
    "01 / REPRODUCIBLE EXAMPLE"
  ],
  [
    "Разница видна в замечаниях.",
    "See the difference in the findings."
  ],
  [
    "Есть таблица",
    "There is a table"
  ],
  [
    "и индекс по",
    "and an index on"
  ],
  [
    ". В миграции добавляем ещё один индекс и внешний ключ.",
    ". The migration adds another index and a foreign key."
  ],
  [
    "Вариант проверки",
    "Review variant"
  ],
  [
    "1. Только миграция",
    "1. Migration only"
  ],
  [
    "2. Со снимком схемы",
    "2. With schema snapshot"
  ],
  [
    "3. После изменения",
    "3. After the change"
  ],
  [
    "Копировать SQL",
    "Copy SQL"
  ],
  [
    "Открыть в редакторе ↗",
    "Open in editor ↗"
  ],
  [
    "Только миграция",
    "Migration only"
  ],
  [
    "Загрузка…",
    "Loading…"
  ],
  [
    "Результат получен текущим ядром на учебном SQL. Кнопки показывают сохранённые результаты примера, а не выполняют SQL.",
    "Results were produced by the current core using sample SQL. Buttons show saved example results; they do not execute SQL."
  ],
  [
    "Какой снимок схемы используется?",
    "Which schema snapshot is used?"
  ],
  [
    "Только структура, без строк данных. Снимок не сверяется с работающей базой автоматически.",
    "Structure only, without data rows. The snapshot is not automatically checked against a running database."
  ],
  [
    "Ноль замечаний не гарантирует отсутствие блокировок.",
    "Zero findings does not guarantee zero blocking."
  ],
  [
    "оставляет проверку существующих строк на отдельный этап; перед применением нужны тестирование, план валидации и проверка транзакций вашего инструмента миграций.",
    "leaves existing rows to be validated separately. Before applying changes, test them, plan validation and check your migration runner's transaction behavior."
  ],
  [
    "Для переключения примеров нужен JavaScript. SQL и воспроизводимый запуск доступны в",
    "Switching examples requires JavaScript. SQL and reproducible commands are in the"
  ],
  [
    "репозитории",
    "repository"
  ],
  [
    "02 / КОГДА НУЖЕН PRO",
    "02 / WHEN PRO HELPS"
  ],
  [
    "От проверки файла — к истории изменений.",
    "From a file review to change history."
  ],
  [
    "Все 12 правил и CLI доступны бесплатно. Pro в серверном кабинете сохраняет контекст и результаты работы организации.",
    "All 12 rules and the CLI are free. Pro in the server workspace saves your organization's context and results."
  ],
  [
    "Снимки схем",
    "Schema snapshots"
  ],
  [
    "До 10 структур SQL / JSON. Выбирайте сохранённую схему для следующих проверок.",
    "Up to 10 SQL / JSON structures. Select a saved schema for subsequent reviews."
  ],
  [
    "Сравнение до / после",
    "Before / after comparison"
  ],
  [
    "Новые, устранённые и оставшиеся замечания. В этом примере снимок тот же, а риск обычного CREATE INDEX устранён.",
    "Introduced, resolved and persisting findings. This example uses the same snapshot, and the ordinary CREATE INDEX finding is resolved."
  ],
  [
    "История организации",
    "Organization history"
  ],
  [
    "До 1000 последних проверок вместо 100 в Community. Участники пилота оценивают это на согласованном серверном экземпляре.",
    "Up to 1,000 most recent reviews instead of 100 in Community. Pilot participants evaluate this on an agreed server instance."
  ],
  [
    "Эта страница показывает учебный сценарий и не активирует Pro. В открытом ядре также доступны передача структуры и анализ; платный кабинет добавляет сохранение и рабочий процесс. Онлайн-оплата пока подключается.",
    "This page shows a sample scenario and does not activate Pro. The open-source core also accepts schema context for analysis; the paid workspace adds persistence and workflow. Online payment is being connected."
  ],
  [
    "03 / ВАШ ПЕРВЫЙ ЗАПУСК",
    "03 / YOUR FIRST RUN"
  ],
  [
    "Начните с готового SQL.",
    "Start with generated SQL."
  ],
  [
    "Выберите способ подготовки миграций. Команды выполняются в вашем проекте; LockGuard читает SQL, а не подключается к базе.",
    "Choose how you prepare migrations. Commands run in your project; LockGuard reads SQL and does not connect to your database."
  ],
  [
    "Создайте SQL без применения новой миграции. Используйте только отдельную базу разработки: Prisma работает с shadow database и при drift может предложить сброс.",
    "Generate SQL without applying the new migration. Use a separate development database only: Prisma uses a shadow database and may suggest a reset if it detects drift."
  ],
  [
    "Затем проверьте созданный",
    "Then review the generated"
  ],
  [
    "через браузерный редактор или CI.",
    "using the browser editor or CI."
  ],
  [
    "Документация Prisma ↗",
    "Prisma documentation ↗"
  ],
  [
    "Сгенерируйте SQL по настройкам вашего drizzle.config.ts:",
    "Generate SQL using your drizzle.config.ts settings:"
  ],
  [
    "Проверьте новые SQL из каталога",
    "Review new SQL files in the"
  ],
  [
    ". Команды",
    ". The commands"
  ],
  [
    "применяют изменения и не нужны для этой проверки.",
    "apply changes and are not needed for this review."
  ],
  [
    "Документация Drizzle ↗",
    "Drizzle documentation ↗"
  ],
  [
    "Подключить проверку к GitHub Actions",
    "Add a GitHub Actions check"
  ],
  [
    "Node.js 24. Настройте",
    "Node.js 24. Configure"
  ],
  [
    ": например,",
    ": for example,"
  ],
  [
    "или каталог",
    "or the directory"
  ],
  [
    "из Drizzle. Этот стартовый вариант проверяет весь указанный каталог, включая старые миграции.",
    "from Drizzle. This starter checks the entire selected directory, including old migrations."
  ],
  [
    "Для воспроизводимости закрепите проверенный SHA вместо main. Отчёт сохраняется артефактом; комментарий в PR автоматически не публикуется. Настройку на изменённые файлы обсудим отдельно на пилоте.",
    "For reproducibility, pin a verified SHA instead of main. The report is saved as an artifact; no PR comment is posted automatically. A changed-files setup can be discussed in the pilot."
  ],
  [
    "ПИЛОТ ДЛЯ ВАШЕЙ КОМАНДЫ",
    "A PILOT FOR YOUR TEAM"
  ],
  [
    "Разберём 1–3 ваши миграции.",
    "Let's review 1–3 of your migrations."
  ],
  [
    "Нужны версия PostgreSQL, инструмент миграций и описание выпуска изменений. Состав, сроки и условия согласуем до начала работы.",
    "Share your PostgreSQL version, migration tool and release workflow. Scope, schedule and terms are agreed before work begins."
  ],
  [
    "Не присылайте пароли, токены или строки пользовательских данных. Публикацию кейса согласуем отдельно.",
    "Do not send passwords, tokens or user records. Publishing a case study requires separate agreement."
  ],
  [
    "Исходный код ↗",
    "Source code ↗"
  ],
  [
    "Контакты и реквизиты — LockGuard",
    "Contact and provider details — LockGuard"
  ],
  [
    "Документы",
    "Documents"
  ],
  [
    "Оферта и возврат",
    "Offer and refunds"
  ],
  [
    "LOCKGUARD · ДОКУМЕНТЫ",
    "LOCKGUARD · DOCUMENTS"
  ],
  [
    "LockGuard — программный инструмент для анализа SQL-миграций PostgreSQL и услуги по их техническому аудиту.",
    "LockGuard is a software tool for PostgreSQL migration analysis, with technical migration audit services."
  ],
  [
    "Кто оказывает услуги",
    "Service provider"
  ],
  [
    "Исполнитель",
    "Provider"
  ],
  [
    "Самозанятый, плательщик налога на профессиональный доход",
    "Self-employed individual paying professional income tax"
  ],
  [
    "ИНН",
    "Taxpayer ID (INN)"
  ],
  [
    "Email и обращения по заказам",
    "Email and order enquiries"
  ],
  [
    "По вопросам заказа, доступа, технической поддержки, отказа от услуги и возврата обращайтесь на email выше. Для поиска заказа укажите его номер и email, использованный при оплате. Данные карты и пароли для обращения не нужны.",
    "For orders, access, technical support, cancellation and refunds, use the email above. Include your order number and the email used for payment to help identify the order. Card details and passwords are not required."
  ],
  [
    "Стоимость и состав заказа",
    "Pricing and order scope"
  ],
  [
    "LockGuard Pro · 1 500 ₽ за 30 дней",
    "LockGuard Pro · 1 500 ₽ for 30 days"
  ],
  [
    "Доступ к согласованному размещённому экземпляру LockGuard и поддержка по его использованию. Перед оплатой согласуются адрес экземпляра и доступные возможности. Срок доступа — 30 дней с активации после подтверждения оплаты. В серверном Pro доступны до 10 сохранённых схем, анализ с их учётом, до 1000 последних проверок и сравнение замечаний между проверками. Продление — отдельной оплатой, автоматических списаний нет.",
    "Access to an agreed hosted LockGuard instance and support using it. The instance address and available features are agreed before payment. Access lasts 30 days from activation after payment confirmation. Server Pro includes up to 10 saved schemas, schema-aware analysis, up to 1,000 most recent reviews and comparison between reviews. Renewal requires a separate payment; there are no automatic charges."
  ],
  [
    "Технический аудит миграций · 30 000 ₽ разово",
    "Technical migration audit · 30 000 ₽ one-off"
  ],
  [
    "Проверка согласованного набора SQL-миграций и сведений о схеме PostgreSQL. Результат — электронный отчёт о выявленных рисках и рекомендации. Объём материалов, срок начала и завершения, формат результата согласуются письменно до оплаты. Дополнительные работы оплачиваются только по отдельному согласованию.",
    "Review of agreed SQL migrations and PostgreSQL schema information. The result is an electronic risk report and recommendations. Materials, scope, start and completion dates and result format are agreed in writing before payment. Extra work requires separate agreement."
  ],
  [
    "Бесплатная браузерная демонстрация и открытое ядро доступны без покупки. Статический анализ и рекомендации не гарантируют отсутствие всех ошибок или простоев; изменения перед применением необходимо проверять на тестовой базе.",
    "The free browser demo and open-source core require no purchase. Static analysis and recommendations do not guarantee detection of every error or zero downtime; test changes on a non-production database before applying them."
  ],
  [
    "Оплата, предоставление и возврат",
    "Payment, delivery and refunds"
  ],
  [
    "При подключённом магазине платёж производится в рублях через Robokassa. Доступ включается после серверного подтверждения оплаты; тестовый платёж не включает рабочий доступ. Физической доставки нет: доступ и результаты предоставляются электронно.",
    "Once the merchant account is connected, payments are made in rubles through Robokassa. Access is enabled after server-side payment confirmation; test payments do not activate production access. There is no physical delivery: access and results are provided electronically."
  ],
  [
    "Сейчас онлайн-оплата находится на этапе подключения. До получения согласованного заказа и действующей платёжной ссылки переводить деньги не требуется. Способы оплаты и чек доступны после подключения соответствующих сервисов магазина.",
    "Online payment is currently being connected. No transfer is required before you receive an agreed order and a valid payment link. Payment methods and receipts become available after the relevant merchant services are connected."
  ],
  [
    "Порядок отказа и возврата описан в",
    "Cancellation and refund procedures are described in the"
  ],
  [
    "оферте",
    "offer"
  ],
  [
    ". До начала оказания услуги оплаченная сумма возвращается полностью. После начала обращение рассматривается с учётом предоставленной части услуги, подтверждённых расходов и обязательных прав заказчика.",
    ". Before the service starts, the payment is refunded in full. After it starts, requests are considered based on the service already provided, documented expenses and the customer's mandatory rights."
  ],
  [
    "Публичная оферта — LockGuard",
    "Public offer — LockGuard"
  ],
  [
    "Условия предоставления доступа к LockGuard и технического аудита SQL-миграций.",
    "Terms for LockGuard access and technical SQL migration audits."
  ],
  [
    "1. Исполнитель и заключение договора",
    "1. Provider and contract formation"
  ],
  [
    "Настоящие условия адресованы заказчикам доступа к LockGuard и услуг технического аудита. Заказчик знакомится с описанием и ценой выбранной услуги и согласованным заказом до оплаты. Оплата согласованного заказа означает принятие относящихся к нему условий оферты. Простое использование бесплатной демонстрации не создаёт обязанности оплатить услугу.",
    "These terms apply to customers purchasing LockGuard access and technical audits. Before payment, the customer reviews the service description, price and agreed order. Paying for the agreed order accepts the offer terms applicable to that order. Using the free demo alone creates no payment obligation."
  ],
  [
    "В индивидуальном заказе могут уточняться объём и сроки работ. Изменение стоимости или состава оплаченного заказа требует согласия заказчика. Новая редакция сайта не меняет уже согласованные условия заказа.",
    "An individual order may specify scope and schedule. Changes to the price or scope of a paid order require the customer's agreement. A new website version does not change terms already agreed for an order."
  ],
  [
    "2. Предмет и стоимость",
    "2. Scope and pricing"
  ],
  [
    "LockGuard Pro — 1 500 ₽ за 30 дней:",
    "LockGuard Pro — 1 500 ₽ for 30 days:"
  ],
  [
    "доступ к согласованному экземпляру сервиса и поддержка по работе с ним. Адрес, доступные функции и необходимые сведения для доступа подтверждаются заказчику до оплаты. Продление производится новой разовой оплатой. Карта для автоматических списаний не сохраняется.",
    "access to an agreed service instance and support using it. The address, available features and required access information are confirmed before payment. Renewal requires a new one-off payment. Cards are not saved for automatic charges."
  ],
  [
    "Технический аудит — 30 000 ₽ разово:",
    "Technical audit — 30 000 ₽ one-off:"
  ],
  [
    "анализ согласованных миграций и схемы PostgreSQL с предоставлением электронного отчёта и рекомендаций. Перечень материалов, объём, сроки начала и окончания и способ передачи результата фиксируются в переписке или заказе до оплаты. Исправление программы заказчика, доступ к production, настройка инфраструктуры и внедрение рекомендаций не входят автоматически в стоимость.",
    "analysis of agreed PostgreSQL migrations and schema, with an electronic report and recommendations. Materials, scope, start and completion dates and result delivery are recorded in correspondence or the order before payment. Fixing the customer's software, production access, infrastructure configuration and implementing recommendations are not automatically included."
  ],
  [
    "В активном Pro на серверном экземпляре доступны до 10 сохранённых схем организации, анализ с их учётом в кабинете и через API-ключ, до 1000 последних проверок и сравнение замечаний между двумя полными проверками. Community сохраняет все 12 правил и до 100 последних проверок в кабинете. После окончания Pro новые записи истории ограничиваются лимитом Community; при добавлении проверки старые записи сверх лимита удаляются. Экспорт и удаление сохранённых схем остаются доступны владельцу аккаунта. Локальное открытое ядро и CLI, включая анализ с файлом схемы, распространяются по MIT.",
    "Active Pro on a server instance includes up to 10 saved organization schemas, schema-aware analysis in the workspace and through an API key, up to 1,000 most recent reviews and comparison of two complete reviews. Community retains all 12 rules and up to 100 recent reviews in the workspace. After Pro expires, new history entries use the Community limit; adding a review removes older entries exceeding that limit. Schema export and deletion remain available to the account owner. The local open-source core and CLI, including analysis with a schema file, are MIT-licensed."
  ],
  [
    "3. Оплата и предоставление результата",
    "3. Payment and delivery"
  ],
  [
    "Расчёты производятся в рублях. При подключённой Robokassa заказчик оплачивает сформированный счёт на защищённой странице платёжного сервиса. Данные банковской карты исполнителю не передаются. Возврат покупателя на сайт после оплаты сам по себе не подтверждает поступление платежа.",
    "Payments are in rubles. Once Robokassa is connected, the customer pays the invoice on the payment provider's secure page. Card details are not sent to the provider of LockGuard services. Returning to the site after payment does not itself confirm payment receipt."
  ],
  [
    "Pro активируется после подтверждения успешной рабочей оплаты сервером. Оплаченный срок составляет 30 дней с активации; продление добавляется к оставшемуся оплаченному сроку. Если доступ не появился, заказчик обращается на email исполнителя с номером заказа. Бесплатный доступ сохраняется независимо от наличия платного заказа.",
    "Pro activates after the server confirms a successful live payment. Access lasts 30 days from activation; renewal adds to any remaining paid period. If access does not appear, contact the provider by email with the order number. Free access remains available regardless of paid orders."
  ],
  [
    "Аудит выполняется после оплаты и получения согласованных материалов в сроки, зафиксированные в заказе. Отчёт передаётся по email либо другим согласованным электронным способом. Физическая доставка товаров не осуществляется. До подключения магазина онлайн-оплата на этом ресурсе не принимается.",
    "An audit starts after payment and receipt of agreed materials, within the schedule recorded in the order. The report is delivered by email or another agreed electronic method. No physical goods are delivered. Until the merchant account is connected, this site does not accept online payments."
  ],
  [
    "Чек самозанятого предоставляется заказчику в установленном порядке. При подключённом сервисе «Робочеки СМЗ» выдача производится через провайдера; отсутствие платёжного уведомления или ссылки на чек можно сообщить исполнителю по email.",
    "A self-employed receipt is provided as required. With Robokassa's self-employed receipt service connected, the provider issues it through that service; missing payment notifications or receipt links can be reported to the provider by email."
  ],
  [
    "4. Использование и ограничения",
    "4. Use and limitations"
  ],
  [
    "Заказчик передаёт только материалы, которыми вправе распоряжаться. Секреты, пароли, персональные данные и содержимое рабочей базы не следует включать в SQL, направляемый на анализ. Доступ к рабочим системам не предполагается без отдельного согласования.",
    "Customers must have the right to share the materials they provide. Do not include secrets, passwords, personal data or production database contents in SQL submitted for analysis. Access to production systems requires separate agreement."
  ],
  [
    "Анализ является технической оценкой предоставленных материалов. Он не заменяет резервное копирование, проверку на тестовой базе и планирование релиза. Оценка блокировок и времени выполнения зависит от реальной схемы, версии PostgreSQL и нагрузки. Исполнитель не обещает гарантированное отсутствие простоев или выявление всех возможных дефектов.",
    "Analysis is a technical assessment of the supplied materials. It does not replace backups, testing on a non-production database or release planning. Locking and execution time depend on the actual schema, PostgreSQL version and load. The provider does not guarantee zero downtime or detection of every possible defect."
  ],
  [
    "5. Отказ от услуги и возврат",
    "5. Cancellation and refunds"
  ],
  [
    "Чтобы отказаться от заказа или запросить возврат, отправьте обращение на",
    "To cancel an order or request a refund, email"
  ],
  [
    ". Укажите номер заказа, email покупателя и суть обращения. Не направляйте реквизиты карты, коды подтверждения и пароли. Исполнитель уточнит сведения, необходимые для идентификации платежа.",
    ". Include your order number, buyer email and a description of your request. Do not send card details, verification codes or passwords. The provider will clarify what is needed to identify the payment."
  ],
  [
    "До активации Pro или начала выполнения аудита оплаченная сумма за неоказанную услугу возвращается полностью. После начала оказания услуги размер возврата определяется с учётом фактически предоставленной части услуги и подтверждённых расходов, без двойного удержания, в пределах, допускаемых применимым законодательством. Неиспользованная часть доступа рассматривается отдельно от уже предоставленного периода.",
    "Before Pro activation or the start of an audit, payment for the unprovided service is refunded in full. After work begins, refunds account for the service actually provided and documented expenses, without double deductions, within applicable legal limits. Unused access is considered separately from access already provided."
  ],
  [
    "При ошибочном повторном платеже, непредоставлении доступа или недостатках услуги заказчик вправе обратиться за восстановлением доступа, устранением недостатков либо возвратом на предусмотренных законом основаниях. Эти условия не ограничивают обязательные права потребителей, включая право отказа от услуги.",
    "For duplicate payments, missing access or service defects, customers may request access restoration, correction or a refund on legally applicable grounds. These terms do not limit mandatory consumer rights, including cancellation rights."
  ],
  [
    "Возврат оформляется после проверки обращения тем же способом, которым был произведён платёж, если это поддерживается платёжным сервисом. Иной способ согласуется с заказчиком. Применяются сроки, установленные законодательством для соответствующего требования; зачисление также зависит от банка и провайдера. Автоматического возврата по нажатию ссылки на сайте нет.",
    "After reviewing the request, refunds use the original payment method where supported by the payment provider. Another method requires the customer's agreement. Statutory time limits for the relevant claim apply; processing also depends on the bank and payment provider. Clicking a website link does not automatically issue a refund."
  ],
  [
    "6. Обращения и данные",
    "6. Enquiries and data"
  ],
  [
    "Поддержка и обращения по исполнению договора:",
    "Support and contract enquiries:"
  ],
  [
    ". Сначала можно описать ситуацию исполнителю; это не отменяет права на предусмотренные законом способы защиты. Порядок обработки контактных данных приведён в",
    ". You may first describe the issue to the provider; this does not remove any right to legal remedies. Contact data handling is described in the"
  ],
  [
    "политике конфиденциальности",
    "privacy policy"
  ],
  [
    "Политика конфиденциальности — LockGuard",
    "Privacy policy — LockGuard"
  ],
  [
    "Политика конфиденциальности",
    "Privacy policy"
  ],
  [
    "Какие сведения используются при обращениях, заказе и работе с LockGuard.",
    "Information used for enquiries, orders and LockGuard operation."
  ],
  [
    "Оператор и связь",
    "Data controller and contact"
  ],
  [
    "Сведения и цели",
    "Information and purposes"
  ],
  [
    "При обращении по email или в Telegram используются переданные вами имя, контакт, текст обращения и материалы, необходимые для ответа. Для заказа используются email покупателя, номер заказа, состав, сумма, статус и время оплаты, оплаченный срок доступа. Цели — согласование и исполнение заказа, предоставление доступа, поддержка, рассмотрение обращений и возвратов, а также исполнение обязанностей по учёту платежей и предоставлению чеков.",
    "Email or Telegram enquiries use the name, contact details, message and materials you provide that are needed to respond. Orders use the buyer email, order number, scope, amount, payment status and time, and paid access period. Purposes include agreeing and fulfilling orders, providing access and support, handling enquiries and refunds, and meeting payment record and receipt obligations."
  ],
  [
    "Не отправляйте пароли, токены, данные карт и избыточные сведения о третьих лицах. Условия передачи конфиденциальных материалов аудита согласуются отдельно.",
    "Do not send passwords, tokens, card details or unnecessary information about others. Terms for sharing confidential audit materials are agreed separately."
  ],
  [
    "Браузер и технические сведения",
    "Browser and technical information"
  ],
  [
    "В Pro пользователь может сохранять нормализованную структуру таблиц, имена столбцов, индексы и сведения об ограничениях. Импортируемый SQL не выполняется и его исходный текст не сохраняется в профиле схемы. Результаты анализа и отчёты могут содержать фрагменты проверяемой миграции. Схемы и отчёты доступны своей организации; их не следует загружать с секретами или строками пользовательских данных.",
    "Pro users can save normalized table structure, column names, indexes and constraint information. Imported SQL is not executed and its source text is not saved in schema profiles. Analysis results and reports may contain parts of the reviewed migration. Schemas and reports are limited to the organization; do not upload secrets or user data rows."
  ],
  [
    "В серверном личном кабинете используются email, название организации, хеш пароля и сведения о сеансах входа для регистрации, авторизации и разделения доступа к ключам API, настройкам и истории проверок. Открытый пароль в базе не сохраняется. Сеанс хранится в необходимом для входа HttpOnly-cookie сроком до 7 дней. Для ограничения попыток входа используются хешированные идентификаторы email и сетевого адреса с окном ограничения 15 минут. База и её резервные копии содержат сведения личного кабинета; при восстановлении копии активные сеансы отзываются.",
    "The server workspace uses email, organization name, password hashes and session information for registration, authentication and separating access to API keys, settings and review history. Plaintext passwords are not stored in the database. Login uses a necessary HttpOnly session cookie for up to 7 days. Login rate limiting uses hashed email and network address identifiers over a 15-minute window. Databases and backups contain account information; restoring a backup revokes active sessions."
  ],
  [
    "На статической демонстрационной странице анализ SQL выполняется в браузере. Сам по себе запуск такого анализа не отправляет введённый SQL исполнителю. При обращении к серверному API SQL передаётся соответствующему серверу для анализа; при отправке материалов в поддержку получателем является выбранный канал связи.",
    "The static demo analyzes SQL in the browser. Running that analysis does not itself send the entered SQL to the provider. Server API analysis sends SQL to the relevant server; materials sent to support go through the selected contact channel."
  ],
  [
    "Страница может сохранять настройки и демонстрационные значения в локальном хранилище браузера. Их можно удалить в настройках сайта в браузере. Хостинг и внешние ресурсы, включая загрузку шрифтов, могут получать IP-адрес и технические сведения, необходимые для доставки страницы. Ссылки на GitHub, Telegram и платёжную страницу ведут на отдельные сервисы с собственными правилами.",
    "The page may save settings and demo values in browser local storage. You can remove them in your browser's site settings. Hosting and external resources, including font delivery, may receive IP addresses and technical information needed to deliver the page. Links to GitHub, Telegram and payment pages lead to separate services with their own policies."
  ],
  [
    "Платежи",
    "Payments"
  ],
  [
    "Платёжная страница Robokassa получает сведения, необходимые для проведения платежа и предоставления чека. Исполнитель не получает полный номер карты, CVV/CVC или коды подтверждения. В приложение поступают идентификатор, сумма и подтверждение результата оплаты. Доступ к истории заказов ограничен администрированием сервиса.",
    "Robokassa's payment page receives information needed to process payment and provide a receipt. The provider of LockGuard services does not receive full card numbers, CVV/CVC or verification codes. The application receives the payment identifier, amount and result confirmation. Order history access is restricted to service administration."
  ],
  [
    "Основания, хранение и обращения",
    "Legal grounds, retention and enquiries"
  ],
  [
    "Контактные данные используются для ответа на ваше обращение и согласования заказа; данные заказа — для заключения и исполнения договора и выполнения предусмотренных законом обязанностей. Для обработки, требующей отдельного согласия, оно запрашивается отдельно: использование сайта не считается безусловным согласием на любые действия с данными.",
    "Contact information is used to answer enquiries and agree orders; order information is used to conclude and perform the contract and meet statutory obligations. Where processing requires separate consent, it is requested separately: using the site is not unconditional consent to any use of data."
  ],
  [
    "Сведения сохраняются в объёме и на срок, необходимый для соответствующей цели и исполнения установленных законом обязанностей. История подтверждённых платежей также используется для защиты от повторной обработки уведомлений. После прекращения цели обработки сведения подлежат удалению или обезличиванию, если их дальнейшее хранение не требуется по законному основанию.",
    "Information is retained only to the extent and for the time needed for its purpose and statutory obligations. Confirmed payment history also prevents duplicate notification processing. When the processing purpose ends, information is deleted or anonymized unless further retention has a lawful basis."
  ],
  [
    "Вопросы о данных, запрос на уточнение или удаление, а также отзыв ранее предоставленного согласия направляйте на",
    "For data enquiries, correction or deletion requests, or withdrawal of previously given consent, email"
  ],
  [
    ". Для исполнения запроса может понадобиться подтверждение принадлежности соответствующего заказа или обращения. Удаление не затрагивает сведения, хранение которых требуется законом.",
    ". Confirming ownership of the relevant order or enquiry may be necessary to fulfil the request. Deletion does not affect information that must be retained by law."
  ],
  [
    "M строк (~",
    "M rows (~"
  ],
  [
    "K строк",
    "K rows"
  ],
  [
    "коннектов",
    "connections"
  ],
  [
    "M ₽ / день",
    "M ₽ / day"
  ],
  [
    "K ₽ / день",
    "K ₽ / day"
  ],
  [
    "✔ Ссылка скопирована!",
    "✔ Link copied!"
  ],
  [
    "✔ Markdown скопирован!",
    "✔ Markdown copied!"
  ],
  [
    "📋 Скопировать Markdown",
    "📋 Copy Markdown"
  ],
  [
    "✔ Скопировано!",
    "✔ Copied!"
  ],
  [
    "📋 Скопировать ключ",
    "📋 Copy key"
  ],
  [
    "Ошибка анализа",
    "Analysis error"
  ],
  [
    "Анализ не выполнен",
    "Analysis not completed"
  ],
  [
    "Проверьте ваш SQL",
    "Review your SQL"
  ],
  [
    "Проверка известных рисков SQL. Оценки нагрузки являются моделью и требуют проверки на вашей базе.",
    "Review of known SQL risks. Load estimates are models and need verification on your database."
  ],
  [
    "Проверяем…",
    "Reviewing…"
  ],
  [
    "Движок анализа ещё не загрузился. Повторите проверку после загрузки страницы.",
    "The analysis engine has not loaded yet. Try again once the page has loaded."
  ],
  [
    "✔ DML: ПРОВЕРКИ DDL НЕ ПРИМЕНЯЮТСЯ",
    "✔ DML: DDL RULES DO NOT APPLY"
  ],
  [
    "Нарушений правил нет",
    "No rule violations"
  ],
  [
    "Таблицы:",
    "Tables:"
  ],
  [
    "Затронутые таблицы не определены.",
    "Affected tables could not be determined."
  ],
  [
    "Запрос изменяет или читает данные. Проверки DDL к нему не применяются; строковые блокировки и ожидания транзакций этой моделью не оцениваются.",
    "This query reads or modifies data. DDL rules do not apply; this model does not evaluate row locks or transaction waits."
  ],
  [
    "Обычное чтение/запись данных (DML)",
    "Regular data reads / writes (DML)"
  ],
  [
    "Нет DDL-операций",
    "No DDL operations"
  ],
  [
    "Модель предназначена для DDL",
    "The model is intended for DDL"
  ],
  [
    "Для DML не оценивается",
    "Not estimated for DML"
  ],
  [
    "Блокирует все обращения, включая SELECT",
    "Blocks all access, including SELECT"
  ],
  [
    "Блокирует INSERT, UPDATE и DELETE",
    "Blocks INSERT, UPDATE and DELETE"
  ],
  [
    "Проверьте конфликты в матрице блокировок",
    "Check conflicts in the lock matrix"
  ],
  [
    "В модели лимит пула достигнут",
    "Pool limit reached in the model"
  ],
  [
    "В модели лимит не достигнут",
    "Pool limit not reached in the model"
  ],
  [
    "Условная модель по заданному обороту",
    "Hypothetical model using the selected turnover"
  ],
  [
    "В модели потери не рассчитаны",
    "Loss not calculated in the model"
  ],
  [
    "Высокий риск коллизии",
    "High collision risk"
  ],
  [
    "Средняя плотность очереди",
    "Moderate queue density"
  ],
  [
    "Низкая вероятность коллизии",
    "Low collision probability"
  ],
  [
    "Ждёт",
    "Waits"
  ],
  [
    "Совместим",
    "Compatible"
  ],
  [
    "✔ Правила не выявили нарушений. Перед релизом нужна проверка на тестовой базе.",
    "✔ No rule violations found. Test on a non-production database before release."
  ],
  [
    "💾 Рерайт диска",
    "💾 Table rewrite"
  ],
  [
    "⚡ Fast Default (Метаданные)",
    "⚡ Fast Default (metadata)"
  ],
  [
    "Скопировано",
    "Copied"
  ],
  [
    "Скопировать SQL",
    "Copy SQL"
  ],
  [
    "Разбиение недоступно: анализ неполный. Необходима ручная проверка SQL.",
    "A change plan is unavailable: analysis is incomplete. Review the SQL manually."
  ],
  [
    "Нет нарушений, для которых доступен шаблон разбиения.",
    "No findings have an available change-plan template."
  ],
  [
    "Правила не выявили нарушений. Разбиение не требуется.",
    "No rule violations found. No change plan is required."
  ],
  [
    "DML: ПРОВЕРКИ DDL НЕ ПРИМЕНЯЮТСЯ",
    "DML: DDL RULES DO NOT APPLY"
  ],
  [
    "ПРАВИЛА НЕ ВЫЯВИЛИ НАРУШЕНИЙ",
    "NO RULE VIOLATIONS FOUND"
  ],
  [
    "НАЙДЕНЫ РИСКИ: НУЖНА ПРОВЕРКА",
    "RISKS FOUND: REVIEW REQUIRED"
  ],
  [
    "Запрос читает или изменяет данные. Строковые блокировки и ожидания транзакций этой моделью не оцениваются. Время ожидания, насыщение пула и потери для DML не рассчитаны.",
    "This query reads or modifies data. The model does not evaluate row locks or transaction waits. DML wait time, pool saturation and loss are not calculated."
  ],
  [
    "Проверенные правила не выявили нарушений. Результат не гарантирует отсутствие простоев; проверьте схему, нагрузку и транзакции на тестовой базе.",
    "The checked rules found no violations. This does not guarantee zero downtime; test the schema, load and transactions on a non-production database."
  ],
  [
    "В скрипте найдены замечания правил. Определённая по SQL максимальная блокировка:",
    "The script has rule findings. Highest table lock inferred from SQL:"
  ],
  [
    "не определена",
    "not determined"
  ],
  [
    ". Длительность зависит от схемы, нагрузки и границ транзакций; оценки ниже являются условной моделью.",
    ". Duration depends on the schema, load and transaction boundaries; the estimates below are a hypothetical model."
  ],
  [
    "Не оценено",
    "Not estimated"
  ],
  [
    "сек",
    "sec"
  ],
  [
    "Антипаттернов блокировок не обнаружено.",
    "No locking antipatterns found."
  ],
  [
    "Пожалуйста, разрешите открытие всплывающего окна в браузере, чтобы сформировать PDF-отчет.",
    "Allow pop-up windows in your browser to create the PDF report."
  ],
  [
    "🚨 ACCESS EXCLUSIVE: Фатальная блокировка таблицы (Full Outage)",
    "🚨 ACCESS EXCLUSIVE: Entire table blocked (full outage risk)"
  ],
  [
    "⛔ SHARE: Блокировка пользовательской записи (Write Freeze)",
    "⛔ SHARE: Writes blocked"
  ],
  [
    "Позволяет продолжать чтение (",
    "Allows reads ("
  ],
  [
    "), но",
    "), but"
  ],
  [
    "полностью блокирует все операции изменения данных",
    "blocks data modifications"
  ],
  [
    "! Все пользовательские транзакции записи встают колом до тех пор, пока не построится весь индекс.",
    "! Write transactions wait until the ordinary index build finishes."
  ],
  [
    "Параллельные SELECT (ACCESS SHARE)",
    "Concurrent SELECT (ACCESS SHARE)"
  ],
  [
    "✅ SHARE UPDATE EXCLUSIVE: Режим параллельных операций",
    "✅ SHARE UPDATE EXCLUSIVE: Concurrent operations"
  ],
  [
    "Совместим с обычным чтением и записью на уровне табличных блокировок. Конфликтует с другим SHARE UPDATE EXCLUSIVE и более сильными режимами. Это не гарантирует отсутствие ожиданий, нагрузки или блокировок других объектов.",
    "Compatible with ordinary reads and writes at the table-lock level. Conflicts with another SHARE UPDATE EXCLUSIVE and stronger modes. This does not guarantee the absence of waits, load or locks on other objects."
  ],
  [
    "Параллельный VACUUM / ANALYZE",
    "Concurrent VACUUM / ANALYZE"
  ],
  [
    "Другой CREATE INDEX CONCURRENTLY",
    "Another CREATE INDEX CONCURRENTLY"
  ],
  [
    "Клиентские SELECT (ACCESS SHARE)",
    "Client SELECT (ACCESS SHARE)"
  ],
  [
    "Клиентские INSERT / UPDATE / DELETE (ROW EXCLUSIVE)",
    "Client INSERT / UPDATE / DELETE (ROW EXCLUSIVE)"
  ],
  [
    "⚡ ROW EXCLUSIVE: Стандартный рабочий поток записи данных",
    "⚡ ROW EXCLUSIVE: Ordinary writes"
  ],
  [
    "Этот лок берется каждой стандартной операцией изменения данных на уровне строки (",
    "This table lock is taken by ordinary row-modifying operations ("
  ],
  [
    "). Не мешает другим транзакциям читать или писать в другие строки, но мгновенно блокируется опасными DDL-миграциями.",
    "). It allows other transactions to read or write other rows, but conflicts with some DDL operations."
  ],
  [
    "Параллельные INSERT/UPDATE (ROW EXCLUSIVE)",
    "Concurrent INSERT/UPDATE (ROW EXCLUSIVE)"
  ],
  [
    "📖 ACCESS SHARE: Стандартный рабочий поток чтения",
    "📖 ACCESS SHARE: Ordinary reads"
  ],
  [
    "Этот лок берется обычным",
    "This lock is taken by an ordinary"
  ],
  [
    "запросом. Совместим со всеми остальными режимами, кроме самого тяжелого —",
    "query. It is compatible with every other mode except"
  ],
  [
    ". Длительное ожидание ACCESS EXCLUSIVE может задерживать последующие запросы.",
    ". A waiting ACCESS EXCLUSIVE request can delay subsequent queries."
  ],
  [
    "🔒 EXCLUSIVE: Эксклюзивная блокировка записи и чтения с блокировками",
    "🔒 EXCLUSIVE: Blocks writes and locking reads"
  ],
  [
    "Блокирует все операции записи и параллельные индексы, но позволяет простое неблокирующее чтение",
    "Blocks writes and concurrent index builds, but allows ordinary non-locking"
  ],
  [
    "Параллельные CREATE INDEX",
    "Concurrent CREATE INDEX"
  ],
  [
    "Простой SELECT (ACCESS SHARE)",
    "Ordinary SELECT (ACCESS SHARE)"
  ],
  [
    "⛔ БЛОК",
    "⛔ BLOCKED"
  ],
  [
    "✔ ОК",
    "✔ OK"
  ],
  [
    "КОНФЛИКТ",
    "CONFLICT"
  ],
  [
    "СОВМЕСТИМЫ",
    "COMPATIBLE"
  ],
  [
    "Таблица:",
    "Table:"
  ],
  [
    "Строка:",
    "Line:"
  ],
  [
    "Техническое описание",
    "Technical details"
  ],
  [
    "💡 Рекомендация для проверки",
    "💡 Recommendation to review"
  ],
  [
    "Показать SQL",
    "Show SQL"
  ],
  [
    "-- Безопасный альтернативный Zero-Downtime код:",
    "-- Alternative SQL draft for review:"
  ],
  [
    "Предварительный просмотр PDF:",
    "PDF preview:"
  ],
  [
    "Нажмите кнопку справа, чтобы сохранить официальный PDF-отчет или распечатать.",
    "Use the button on the right to save the report as PDF or print it."
  ],
  [
    "Сохранить как PDF",
    "Save as PDF"
  ],
  [
    "Объект аудита:",
    "Review target:"
  ],
  [
    "Миграционный DDL-скрипт (PostgreSQL 11 – 17+)",
    "Migration DDL script (PostgreSQL 11 – 17+)"
  ],
  [
    "Аудитор:",
    "Analyzer:"
  ],
  [
    "Параметры прод-базы:",
    "Database model inputs:"
  ],
  [
    "Контакты команды:",
    "Team contact:"
  ],
  [
    "Макс. Блокировка",
    "Highest lock"
  ],
  [
    "Время по модели",
    "Time in the model"
  ],
  [
    "Ожидание по модели",
    "Waits in the model"
  ],
  [
    "Условные потери",
    "Hypothetical loss"
  ],
  [
    "Нарушений в коде",
    "Rule violations"
  ],
  [
    "2. Черновой план изменений для ручной проверки",
    "2. Draft change plan for manual review"
  ],
  [
    "Для предотвращения простоя опасная миграция автоматически разделена на изолированные неблокирующие шаги:",
    "Draft steps generated from the findings. Review completeness, ordering and applicability on a non-production database:"
  ],
  [
    "3. Заключение и экспертные рекомендации",
    "3. Summary and recommendations to review"
  ],
  [
    "Интеграция в CI/CD:",
    "CI/CD integration:"
  ],
  [
    "Рекомендуется подключить автоматический линтер",
    "Consider adding the"
  ],
  [
    "в GitHub Actions для автоматической блокировки PR с опасным DDL.",
    "linter to GitHub Actions to flag PRs containing known DDL risks."
  ],
  [
    "Обязательный таймаут:",
    "Required timeout:"
  ],
  [
    "Каждая транзакция DDL должна начинаться с директивы",
    "Start DDL transactions with"
  ],
  [
    "во избежание Head-of-Line блокировок.",
    "to limit head-of-line waits."
  ],
  [
    "Фоновое построение индексов:",
    "Concurrent index builds:"
  ],
  [
    "Все индексы должны создаваться с модификатором",
    "Where applicable, review building indexes with"
  ],
  [
    "вне транзакционных блоков.",
    "outside transaction blocks."
  ],
  [
    "Официальный аудит LockGuard Engine • Конфиденциально для руководства команды",
    "LockGuard automated analysis report • Intended for the reviewing team"
  ],
  [
    "Заказать аудит всей инфраструктуры баз данных:",
    "Discuss a database migration audit:"
  ],
  [
    "Токен администратора (оставьте пустым для выхода):",
    "Administrator token (leave empty to sign out):"
  ],
  [
    "Откройте http://localhost:3000 после запуска npm start или используйте браузерное демо.",
    "Open http://localhost:3000 after running npm start, or use the browser demo."
  ],
  [
    "Не удалось прочитать SQL из ссылки. Вставьте его в редактор.",
    "Could not read SQL from the link. Paste it into the editor."
  ],
  [
    "Оплата прервана. Заказ не активирован.",
    "Payment cancelled. The order was not activated."
  ],
  [
    "Возврат с оплаты. Статус заказа проверяется по уведомлению Robokassa.",
    "Returned from payment. Order status is confirmed through Robokassa notifications."
  ],
  [
    "Название сохранено.",
    "Name saved."
  ],
  [
    "Пароль изменён. Остальные сеансы завершены.",
    "Password changed. Other sessions have been signed out."
  ],
  [
    "Создать аккаунт",
    "Create account"
  ],
  [
    "Не удалось подключиться к серверу:",
    "Could not connect to the server:"
  ],
  [
    "Вы вошли. Ключи и история доступны только вашей организации.",
    "Signed in. Keys and history are private to your organization."
  ],
  [
    "Вы вышли из аккаунта.",
    "Signed out."
  ],
  [
    "Войдите, чтобы открыть данные своей организации.",
    "Sign in to view your organization's data."
  ],
  [
    "Вставьте SQL для проверки.",
    "Paste SQL to review."
  ],
  [
    "Проверяем SQL…",
    "Reviewing SQL…"
  ],
  [
    "Не удалось проверить SQL",
    "Could not review SQL"
  ],
  [
    "Ошибка анализа:",
    "Analysis error:"
  ],
  [
    "Вставьте SQL для подготовки плана.",
    "Paste SQL to prepare a change plan."
  ],
  [
    "Готовим план…",
    "Preparing plan…"
  ],
  [
    "Не удалось подготовить план",
    "Could not prepare a change plan"
  ],
  [
    "Правила не выявили нарушений. План изменений не требуется.",
    "No rule violations found. No change plan is required."
  ],
  [
    "SQL этапа скопирован.",
    "Phase SQL copied."
  ],
  [
    "Ошибка подготовки плана:",
    "Change plan error:"
  ],
  [
    "Найдены риски",
    "Risks found"
  ],
  [
    "Нет оценки блокировки",
    "No lock estimate"
  ],
  [
    "Нет",
    "None"
  ],
  [
    "SQL-рекомендация скопирована.",
    "SQL recommendation copied."
  ],
  [
    "до",
    "until"
  ],
  [
    "Здесь появятся ваши проверки. Начните с редактора SQL.",
    "Your reviews will appear here. Start in the SQL editor."
  ],
  [
    "Без нарушений",
    "No violations"
  ],
  [
    "Есть риски",
    "Risks found"
  ],
  [
    "Проверка API",
    "API review"
  ],
  [
    "Ручная проверка",
    "Manual review"
  ],
  [
    "Ключей пока нет. Создайте ключ для подключения серверного API.",
    "No keys yet. Create a key to connect to the server API."
  ],
  [
    "Ещё нет",
    "Not yet"
  ],
  [
    "Активен",
    "Active"
  ],
  [
    "Отозван",
    "Revoked"
  ],
  [
    "Ошибка тестового PR:",
    "Test PR error:"
  ],
  [
    "Название ключа API (например, GitHub Actions CI):",
    "API key name (for example, GitHub Actions CI):"
  ],
  [
    "Сохраните ключ API сейчас. Повторно он не отображается:",
    "Save the API key now. It will not be shown again:"
  ],
  [
    "Ошибка создания ключа:",
    "Key creation error:"
  ],
  [
    "Отозвать ключ API? Проверки CI, использующие этот ключ, перестанут работать.",
    "Revoke this API key? CI checks using it will stop working."
  ],
  [
    "Ключ API отозван.",
    "API key revoked."
  ],
  [
    "Ошибка отзыва ключа:",
    "Key revocation error:"
  ],
  [
    "Ключ API скопирован.",
    "API key copied."
  ],
  [
    "Подробный отчёт этой старой проверки не сохранён.",
    "The detailed report for this older review was not saved."
  ],
  [
    "Бесплатный анализ доступен без оплаты.",
    "Free analysis requires no payment."
  ],
  [
    "Онлайн-оплата подключается. Условия и контакты доступны на странице «Тарифы».",
    "Online payment is being connected. Terms and contact information are on the Pricing page."
  ],
  [
    "Email покупателя для заказа и чека:",
    "Buyer email for the order and receipt:"
  ],
  [
    "Создан тестовый заказ. Рабочий доступ не изменится.",
    "Test order created. Production access will not change."
  ],
  [
    "Заказ создан. Оплатите на странице Robokassa, затем обновите статус.",
    "Order created. Pay on Robokassa, then refresh the status."
  ],
  [
    "Ошибка заказа:",
    "Order error:"
  ],
  [
    "Ожидает оплаты",
    "Awaiting payment"
  ],
  [
    "Оплачен",
    "Paid"
  ],
  [
    "Тестовая оплата — рабочий доступ не изменён",
    "Test payment — production access unchanged"
  ],
  [
    ". Аудит ожидает выполнения.",
    ". Audit awaiting delivery."
  ],
  [
    "Бесплатный анализ",
    "Free analysis"
  ],
  [
    "Текущий план",
    "Current plan"
  ],
  [
    "Продлить на 30 дней — 1 500 ₽",
    "Renew for 30 days — 1 500 ₽"
  ],
  [
    "Оплатить 30 дней — 1 500 ₽",
    "Buy 30 days — 1 500 ₽"
  ],
  [
    "Оплатить аудит — 30 000 ₽",
    "Order an audit — 30 000 ₽"
  ],
  [
    "ЖДЁТ",
    "WAITS"
  ],
  [
    "Проверьте полноту и порядок этапов на тестовой базе перед применением.",
    "Review phase completeness and ordering on a non-production database before applying them."
  ],
  [
    "SQL для проверки",
    "SQL to review"
  ],
  [
    "Правила не выявили нарушений.",
    "No rule violations found."
  ],
  [
    "Перед релизом проверьте схему, границы транзакций и нагрузку.",
    "Before release, review the schema, transaction boundaries and load."
  ],
  [
    "Правило:",
    "Rule:"
  ],
  [
    "| Таблица:",
    "| Table:"
  ],
  [
    "| Блокировка:",
    "| Lock:"
  ],
  [
    "| Строка:",
    "| Line:"
  ],
  [
    "Рекомендация для ручной проверки",
    "Recommendation for manual review"
  ],
  [
    "Блокировка:",
    "Lock:"
  ],
  [
    "Открыть отчёт",
    "Open report"
  ],
  [
    "Секрет доступен только при создании",
    "The secret is only available when created"
  ],
  [
    "Отозвать",
    "Revoke"
  ],
  [
    "Файл должен быть не больше 512 КБ.",
    "The file must not exceed 512 KB."
  ],
  [
    "табл.",
    "tables"
  ],
  [
    "PRO · до 10 схем организации",
    "PRO · up to 10 organization schemas"
  ],
  [
    "Сохранённых схем пока нет.",
    "No saved schemas yet."
  ],
  [
    "Экспорт JSON",
    "Export JSON"
  ],
  [
    "Удалить",
    "Delete"
  ],
  [
    "Проверяем структуру…",
    "Checking structure…"
  ],
  [
    "Схема сохранена и выбрана для анализа. Исходный SQL схемы не выполнялся и не сохранялся.",
    "Schema saved and selected for analysis. The original schema SQL was not executed or saved."
  ],
  [
    "Удалить сохранённую схему? Результаты прежних проверок останутся в истории.",
    "Delete this saved schema? Previous review results will remain in history."
  ],
  [
    "Сравниваем замечания…",
    "Comparing findings…"
  ],
  [
    "Устранены",
    "Resolved"
  ],
  [
    "Новые",
    "Introduced"
  ],
  [
    "Остались",
    "Persisting"
  ],
  [
    "Снимки схем различаются. Это могло изменить результат.",
    "The schema snapshots differ. This may have changed the result."
  ],
  [
    "Выбраны разные файлы.",
    "Different files selected."
  ],
  [
    "Сопоставление учитывает правило, объект и уровень риска. Отсутствие замечаний не гарантирует безопасный релиз.",
    "Comparison uses the rule, object and severity. Zero findings does not guarantee a safe release."
  ],
  [
    "Пример недоступен",
    "Example unavailable"
  ],
  [
    "LG-002 отмечает построение индекса с блокировкой записи. LG-011 просит подтвердить индекс для внешнего ключа: в самой миграции его нет, но в существующей схеме он есть.",
    "LG-002 flags an index build that blocks writes. LG-011 asks you to confirm a foreign-key index: it is missing from the migration but exists in the current schema."
  ],
  [
    "Со снимком схемы",
    "With schema snapshot"
  ],
  [
    "Импортированная структура подтверждает индекс orders(account_id), поэтому LG-011 не появляется. Замечание LG-002 о новом обычном индексе остаётся.",
    "The imported structure confirms the orders(account_id) index, so LG-011 is not reported. LG-002 still flags the new ordinary index build."
  ],
  [
    "После изменения",
    "After the change"
  ],
  [
    "CREATE INDEX заменён на CONCURRENTLY вне транзакции. В сравнении на одном снимке схемы LG-002 устранён; новых замечаний нет. Это не проверка на работающей базе.",
    "CREATE INDEX was changed to CONCURRENTLY outside a transaction. Comparing against the same schema snapshot resolves LG-002 without introducing new findings. This is not a test on a running database."
  ],
  [
    "замечание",
    "finding"
  ],
  [
    "замечаний",
    "findings"
  ],
  [
    "В этом примере замечаний нет. Проверьте миграцию на тестовой базе.",
    "No findings in this example. Test the migration on a non-production database."
  ],
  [
    "Анализ неполный. Нужна ручная проверка.",
    "Analysis is incomplete. Manual review is required."
  ],
  [
    "SQL скопирован.",
    "SQL copied."
  ],
  [
    "Не удалось скопировать автоматически. Выделите SQL в блоке выше.",
    "Could not copy automatically. Select the SQL in the block above."
  ],
  [
    "Конструкция требует ручной проверки",
    "Construct requires manual review"
  ],
  [
    "DEFAULT может вызвать перезапись таблицы",
    "DEFAULT may rewrite the table"
  ],
  [
    "Индекс создаётся без CONCURRENTLY",
    "Index built without CONCURRENTLY"
  ],
  [
    "Внешний ключ добавляется без NOT VALID",
    "Foreign key added without NOT VALID"
  ],
  [
    "Изменение типа может перезаписать таблицу",
    "Type change may rewrite the table"
  ],
  [
    "UNIQUE добавляется напрямую",
    "UNIQUE added directly"
  ],
  [
    "Удаление таблицы или столбца без этапа совместимости",
    "Table or column removed without a compatibility phase"
  ],
  [
    "VACUUM или настройка autovacuum внутри транзакции",
    "VACUUM or autovacuum settings inside a transaction"
  ],
  [
    "Не задан действующий lock_timeout",
    "No effective lock_timeout"
  ],
  [
    "NOT NULL добавляется без предварительной проверки",
    "NOT NULL added without prior validation"
  ],
  [
    "CONCURRENTLY внутри транзакции",
    "CONCURRENTLY inside a transaction"
  ],
  [
    "У внешнего ключа нет подходящего индекса",
    "No confirmed supporting index for the foreign key"
  ],
  [
    "TRUNCATE или блокирующий REFRESH MATERIALIZED VIEW",
    "TRUNCATE or blocking REFRESH MATERIALIZED VIEW"
  ],
  [
    "Критический",
    "Critical"
  ],
  [
    "Высокий",
    "High"
  ],
  [
    "Средний",
    "Medium"
  ],
  [
    "Низкий",
    "Low"
  ],
  [
    "Конфликтует только с ACCESS EXCLUSIVE",
    "Only conflicts with ACCESS EXCLUSIVE"
  ],
  [
    "Совместим с обычным чтением и записью",
    "Compatible with ordinary reads and writes"
  ],
  [
    "Режим обычных операций записи",
    "Ordinary write operation lock"
  ],
  [
    "Совместим с чтением и записью; возможны другие ожидания",
    "Compatible with reads and writes; other waits are possible"
  ],
  [
    "Блокирует параллельную запись и изменения схемы",
    "Blocks concurrent writes and schema changes"
  ],
  [
    "Допускает обычный SELECT",
    "Allows ordinary SELECT"
  ],
  [
    "Блокирует все обращения к таблице, включая SELECT",
    "Blocks all table access, including SELECT"
  ]
];

/* Parameterized UI messages. Captured values are copied verbatim. */
window.LockGuardTranslations.push(...[
  [
    "SQL-миграция PostgreSQL",
    "PostgreSQL migration SQL"
  ],
  [
    "Редакция от",
    "Updated"
  ],
  [
    "Нет подписей",
    "No signatures"
  ],
  [
    "Найдены риски · {0}",
    "Risks found · {0}"
  ],
  [
    "Замечания · {0}",
    "Findings · {0}"
  ],
  [
    "{0} критических, {1} высоких",
    "{0} critical, {1} high"
  ],
  [
    "Модель: {0} млн строк",
    "Model: {0} million rows"
  ],
  [
    "{0} M строк (~{1} GB)",
    "{0}M rows (~{1} GB)"
  ],
  [
    "{0} K строк",
    "{0}K rows"
  ],
  [
    "{0} коннектов",
    "{0} connections"
  ],
  [
    "{0} M ₽ / день",
    "{0}M ₽ / day"
  ],
  [
    "{0} K ₽ / день",
    "{0}K ₽ / day"
  ],
  [
    "{0} замечание",
    "{0} finding"
  ],
  [
    "{0} замечания",
    "{0} findings"
  ],
  [
    "{0} замечаний",
    "{0} findings"
  ],
  [
    "Устранено: {0} · новых: {1}",
    "Resolved: {0} · introduced: {1}"
  ],
  [
    "Ошибка анализа: {0}",
    "Analysis error: {0}"
  ],
  [
    "Не удалось подключиться к серверу: {0}",
    "Could not connect to the server: {0}"
  ],
  [
    "Ошибка подготовки плана: {0}",
    "Change plan error: {0}"
  ],
  [
    "Ошибка создания ключа: {0}",
    "Key creation error: {0}"
  ],
  [
    "Ошибка отзыва ключа: {0}",
    "Key revocation error: {0}"
  ],
  [
    "Ошибка заказа: {0}",
    "Order error: {0}"
  ],
  [
    "Ошибка тестового PR: {0}",
    "Test PR error: {0}"
  ],
  [
    "Подготовлено этапов: {0}. Нужна ручная проверка.",
    "Prepared phases: {0}. Manual review is required."
  ],
  [
    "Тестовый PR #{0} проверен: {1}",
    "Test PR #{0} reviewed: {1}"
  ],
  [
    "Таблиц: {0}",
    "Tables: {0}"
  ],
  [
    "Устранены · {0}",
    "Resolved · {0}"
  ],
  [
    "Новые · {0}",
    "Introduced · {0}"
  ],
  [
    "Остались · {0}",
    "Persisting · {0}"
  ],
  [
    "✔ Совместим: {0}",
    "✔ Compatible: {0}"
  ],
  [
    "⛔ Блокирует: {0}",
    "⛔ Blocks: {0}"
  ],
  [
    "{0}: КОНФЛИКТ",
    "{0}: CONFLICT"
  ],
  [
    "{0}: СОВМЕСТИМЫ",
    "{0}: COMPATIBLE"
  ],
  [
    "ℹ️ {0}: Режим блокировки таблицы",
    "ℹ️ {0}: Table lock mode"
  ],
  [
    "Блокирует операции, конфликтующие с данным уровнем блокировки согласно официальной спецификации PostgreSQL.",
    "Blocks operations that conflict with this lock mode according to the PostgreSQL documentation."
  ],
  [
    "⏱️ Расчетное время лока: ~{0} ({1})",
    "⏱️ Estimated lock time: ~{0} ({1})"
  ],
  [
    "({0} крит.)",
    "({0} critical)"
  ],
  [
    "PRO до {0}",
    "PRO until {0}"
  ],
  [
    "1. Результат статического анализа",
    "1. Static analysis result"
  ],
  [
    "1. Результаты анализа",
    "1. Analysis results"
  ],
  [
    "Расчетный простой базы:",
    "Estimated database downtime:"
  ],
  [
    "Здесь появятся этапы плана.",
    "Plan phases will appear here."
  ],
  [
    "Стоимость",
    "Price"
  ],
  [
    "Оплата",
    "Payment"
  ],
  [
    "Дата",
    "Date"
  ]
]);

window.LockGuardTranslations.push(...[
  [
    "Ключ создан.",
    "Key created."
  ],
  [
    "таблиц:",
    "tables:"
  ],
  [
    "индексов:",
    "indexes:"
  ],
  [
    "Схема:",
    "Schema:"
  ],
  [
    "Анализ учитывает импортированную структуру. Снимок не сверяется с работающей базой и не измеряет длительность блокировок.",
    "Analysis uses the imported structure. The snapshot is not checked against a running database and does not measure lock duration."
  ],
  [
    "замеч.",
    "findings"
  ],
  [
    "строка",
    "line"
  ]
]);

window.LockGuardTranslations.push(...[
  [
    "Черновые этапы требуют ручной проверки полноты, порядка и применимости на тестовой базе:",
    "Draft steps require manual review of completeness, ordering and applicability on a non-production database:"
  ],
  [
    "Автоматический отчёт LockGuard • Для команды проверки",
    "LockGuard automated report • For the reviewing team"
  ]
]);

window.LockGuardTranslations.push(...[
  [
    "{0}M строк (~{1} GB)",
    "{0}M rows (~{1} GB)"
  ],
  [
    "{0}K строк",
    "{0}K rows"
  ],
  [
    "{0} сек",
    "{0} sec"
  ],
  [
    "Пул PgBouncer ({0})",
    "PgBouncer pool ({0})"
  ],
  [
    "1. Анализ блокировок и найденные антипаттерны ({0})",
    "1. Lock analysis and identified risks ({0})"
  ],
  [
    "📦 [ЭТАП {0}]: {1}",
    "📦 [PHASE {0}]: {1}"
  ]
]);

window.LockGuardTranslations.push(...[
  [
    "Дата отчета: {0}",
    "Report date: {0}"
  ],
  [
    "Таблица: {0}M строк (~{1} GB) | Трафик: {2} RPS ({3} vCPU)",
    "Table: {0}M rows (~{1} GB) | Traffic: {2} RPS ({3} vCPU)"
  ],
  [
    "Таблица: {0}K строк | Трафик: {1} RPS ({2} vCPU)",
    "Table: {0}K rows | Traffic: {1} RPS ({2} vCPU)"
  ]
]);

window.LockGuardTranslations.push(...[
  [
    "Ждёт: {0}",
    "Waits: {0}"
  ],
  [
    "Совместим: {0}",
    "Compatible: {0}"
  ]
]);

window.LockGuardTranslations.push(...[
  [
    "{0} января {1} года.",
    "January {0}, {1}."
  ],
  [
    "{0} февраля {1} года.",
    "February {0}, {1}."
  ],
  [
    "{0} марта {1} года.",
    "March {0}, {1}."
  ],
  [
    "{0} апреля {1} года.",
    "April {0}, {1}."
  ],
  [
    "{0} мая {1} года.",
    "May {0}, {1}."
  ],
  [
    "{0} июня {1} года.",
    "June {0}, {1}."
  ],
  [
    "{0} июля {1} года.",
    "July {0}, {1}."
  ],
  [
    "{0} августа {1} года.",
    "August {0}, {1}."
  ],
  [
    "{0} сентября {1} года.",
    "September {0}, {1}."
  ],
  [
    "{0} октября {1} года.",
    "October {0}, {1}."
  ],
  [
    "{0} ноября {1} года.",
    "November {0}, {1}."
  ],
  [
    "{0} декабря {1} года.",
    "December {0}, {1}."
  ]
]);
