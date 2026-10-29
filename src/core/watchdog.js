/**
 * LockGuard Post-Deploy Watchdog
 * Inspects database for broken / invalid indexes (indisvalid = false)
 * caused by interrupted or failed CREATE INDEX CONCURRENTLY migrations.
 */

class PostDeployWatchdog {
  /**
   * Generates watchdog diagnostic queries and evaluations.
   */
  static getDiagnosticQuery() {
    return `
      SELECT 
        idx.indexrelid::regclass AS index_name,
        tbl.relname AS table_name,
        idx.indisvalid AS is_valid,
        pg_size_pretty(pg_relation_size(idx.indexrelid)) AS index_size
      FROM pg_index idx
      JOIN pg_class tbl ON tbl.oid = idx.indrelid
      WHERE NOT idx.indisvalid;
    `.trim();
  }

  /**
   * Evaluates watchdog results from database query or mock telemetry.
   * @param {Array<object>} queryRows [{ index_name, table_name, is_valid, index_size }]
   */
  static evaluate(queryRows = []) {
    const invalidIndexes = [];

    // If no rows passed, check for simulated test case
    const rows = Array.isArray(queryRows) ? queryRows : [];

    for (const row of rows) {
      if (row.is_valid === false || row.indisvalid === false) {
        const indexName = row.index_name || row.indexrelid || 'broken_idx';
        const tableName = row.table_name || 'orders';
        const size = row.index_size || 'Unknown size';

        invalidIndexes.push({
          indexName,
          tableName,
          size,
          hazard: 'INVALID_INDEX_DEGRADATION',
          impact: `Индекс '${indexName}' на таблице '${tableName}' остался в статусе INVALID после сбоя CONCURRENTLY! Он не ускоряет чтение, но замедляет каждую операцию INSERT/UPDATE и расходует диск (${size}).`,
          safeFix: [
            `-- Вариант 1: Безопасное перестроение без блокировки чтения и записи`,
            `REINDEX INDEX CONCURRENTLY ${indexName};`,
            ``,
            `-- Вариант 2: Безопасное удаление битого индекса`,
            `DROP INDEX CONCURRENTLY IF EXISTS ${indexName};`
          ].join('\n')
        });
      }
    }

    return {
      healthy: invalidIndexes.length === 0,
      totalInvalidCount: invalidIndexes.length,
      invalidIndexes,
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = PostDeployWatchdog;
