/* Human-facing Russian labels; SQL identifiers and machine reports stay intact. */
window.LockGuardLabels = {
  titles: {
    'LG-000': 'Конструкция требует ручной проверки',
    'LG-001': 'DEFAULT может вызвать перезапись таблицы',
    'LG-002': 'Индекс создаётся без CONCURRENTLY',
    'LG-003': 'Внешний ключ добавляется без NOT VALID',
    'LG-004': 'Изменение типа может перезаписать таблицу',
    'LG-005': 'UNIQUE добавляется напрямую',
    'LG-006': 'Удаление таблицы или столбца без этапа совместимости',
    'LG-007': 'VACUUM или настройка autovacuum внутри транзакции',
    'LG-008': 'Не задан действующий lock_timeout',
    'LG-009': 'NOT NULL добавляется без предварительной проверки',
    'LG-010': 'CONCURRENTLY внутри транзакции',
    'LG-011': 'У внешнего ключа нет подходящего индекса',
    'LG-012': 'TRUNCATE или блокирующий REFRESH MATERIALIZED VIEW'
  },
  severity: { CRITICAL: 'Критический', HIGH: 'Высокий', MEDIUM: 'Средний', LOW: 'Низкий' },
  impact: {
    'ACCESS SHARE': 'Конфликтует только с ACCESS EXCLUSIVE',
    'ROW SHARE': 'Совместим с обычным чтением и записью',
    'ROW EXCLUSIVE': 'Режим обычных операций записи',
    'SHARE UPDATE EXCLUSIVE': 'Совместим с чтением и записью; возможны другие ожидания',
    'SHARE': 'Блокирует INSERT, UPDATE и DELETE',
    'SHARE ROW EXCLUSIVE': 'Блокирует параллельную запись и изменения схемы',
    'EXCLUSIVE': 'Допускает обычный SELECT',
    'ACCESS EXCLUSIVE': 'Блокирует все обращения к таблице, включая SELECT'
  }
};
