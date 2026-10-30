/**
 * LockGuard Post-Deploy Watchdog
 * Inspects database for broken / invalid indexes (indisvalid = false)
 * caused by interrupted or failed CREATE INDEX CONCURRENTLY migrations.
 */

const { execFileSync } = require('child_process');

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
          impact: `Index '${indexName}' on table '${tableName}' remains in INVALID status after failed CONCURRENTLY! It does not speed up reads, but slows down every INSERT/UPDATE and consumes disk space (${size}).`,
          safeFix: [
            `-- Option 1: Rebuild index safely without blocking reads or writes`,
            `REINDEX INDEX CONCURRENTLY ${indexName};`,
            ``,
            `-- Option 2: Safely drop invalid index`,
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

  /**
   * Inspects production index health and formats a user-friendly report for CLI.
   * If process.env.DATABASE_URL is set and queryRows is empty/not provided,
   * queries live database via psql.
   * @param {Array<object>} queryRows Optional database query rows
   */
  static inspectProduction(queryRows = []) {
    let rows = queryRows;

    if ((!rows || rows.length === 0) && process.env.DATABASE_URL) {
      try {
        const sql = this.getDiagnosticQuery().replace(/\r?\n/g, ' ');
        const raw = execFileSync('psql', ['-X', '-w', '-d', process.env.DATABASE_URL, '-t', '-A', '-F', ',', '-c', sql], {
          encoding: 'utf8',
          timeout: 15000,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        rows = raw
          .split(/\r?\n/)
          .filter(line => line.trim().length > 0)
          .map(line => {
            const [index_name, table_name, is_valid, index_size] = line.split(',');
            return {
              index_name: index_name ? index_name.trim() : '',
              table_name: table_name ? table_name.trim() : '',
              is_valid: is_valid ? (is_valid.trim() === 't' || is_valid.trim() === 'true') : false,
              index_size: index_size ? index_size.trim() : '0 bytes'
            };
          });
      } catch {
        throw new Error('Unable to inspect database index health: psql query failed.');
      }
    }

    const evalResult = this.evaluate(rows || []);
    const hasBrokenIndexes = !evalResult.healthy;

    let message = '';
    if (hasBrokenIndexes) {
      message = `❌ Detected ${evalResult.totalInvalidCount} INVALID/BROKEN index(es) on production!\n` +
        evalResult.invalidIndexes.map(idx => 
          `  • [BROKEN] ${idx.indexName} on ${idx.tableName} (${idx.size})\n    ${idx.impact}\n    Safe Fix:\n${idx.safeFix}`
        ).join('\n\n');
    } else {
      message = '✔ Production index health: 100% healthy. No broken or invalid indexes found.';
    }

    return {
      ...evalResult,
      hasBrokenIndexes,
      message
    };
  }
}

module.exports = PostDeployWatchdog;
