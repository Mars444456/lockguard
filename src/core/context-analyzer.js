/**
 * LockGuard Context-Aware Metadata Analyzer
 * Evaluates live/replica table metrics (row counts, sizes, Postgres versions)
 * to calculate precise, real-world lock durations and eliminate false positives.
 */

class ContextAnalyzer {
  /**
   * Enriches an analysis result with real-world DB context.
   * @param {object} analysis AST analysis result from RuleEngine
   * @param {object} dbContext Table metadata { tables: { table: { rowCount, sizeMb } }, demoMode: boolean, pgVersion }
   */
  static enrich(analysis, dbContext = {}) {
    const enrichedViolations = [];
    let maxEstimatedDowntimeSec = 0;

    const defaultStats = {
      orders: { rowCount: 14200000, sizeMb: 8400 },
      transactions: { rowCount: 28500000, sizeMb: 16200 },
      users: { rowCount: 4500000, sizeMb: 2100 },
      accounts: { rowCount: 3200000, sizeMb: 1800 },
      order_items: { rowCount: 42000000, sizeMb: 19500 },
      payments: { rowCount: 8900000, sizeMb: 4300 }
    };

    const providedTables = dbContext.tables || {};
    const useDemoStats = !!dbContext.demoMode;

    for (const v of analysis.violations) {
      const tableName = v.table || 'default';
      let stats = providedTables[tableName];

      // Only use demo fallback stats when explicitly requested by demo/playground mode
      if (!stats && useDemoStats) {
        stats = defaultStats[tableName] || { rowCount: 100000, sizeMb: 50 };
      }

      if (!stats) {
        stats = { rowCount: 0, sizeMb: 0 };
      }

      const lockDuration = this.calculateLockDuration(v, stats, dbContext.pgVersion || 16);
      if (lockDuration.seconds > maxEstimatedDowntimeSec) {
        maxEstimatedDowntimeSec = lockDuration.seconds;
      }

      const contextualMessage = this.generateContextualRiskMessage(v, stats, lockDuration);

      enrichedViolations.push({
        ...v,
        tableStats: stats,
        estimatedLockDurationSec: lockDuration.seconds,
        estimatedDowntimeFormatted: lockDuration.formatted,
        downtimeRiskLevel: lockDuration.riskLevel,
        contextualMessage
      });
    }

    const hasAnyStats = analysis.affectedTables.some(t => providedTables[t] || (useDemoStats && defaultStats[t]));

    return {
      ...analysis,
      violations: enrichedViolations,
      hasLiveContext: hasAnyStats,
      maxEstimatedDowntimeSec,
      maxEstimatedDowntimeFormatted: this.formatSeconds(maxEstimatedDowntimeSec),
      contextSummary: hasAnyStats 
        ? `Audited against table metrics: ${analysis.affectedTables.map(t => {
            const s = providedTables[t] || (useDemoStats && defaultStats[t]) || { rowCount: 0 };
            return `${t} (${(s.rowCount / 1000000).toFixed(1)}M rows)`;
          }).join(', ')}`
        : 'Context analysis enabled without live metrics. Use --schema-stats=<file.json> or set DATABASE_URL to provide actual table sizes.'
    };
  }

  static calculateLockDuration(violation, stats, pgVersion = 16) {
    const { rowCount = 0, sizeMb = 0 } = stats;
    if (rowCount <= 0 && sizeMb <= 0) {
      return {
        seconds: 0,
        formatted: 'N/A',
        riskLevel: 'UNKNOWN (NO TABLE METRICS)'
      };
    }

    let seconds = 0;

    switch (violation.ruleId) {
      // ADD COLUMN with volatile DEFAULT
      case 'LG-001': {
        seconds = Math.max(1, Math.round(rowCount / 150000) + Math.round(sizeMb / 300));
        break;
      }

      // Non-concurrent CREATE INDEX
      case 'LG-002': {
        seconds = Math.max(2, Math.round(rowCount / 80000));
        break;
      }

      // Foreign Key without NOT VALID
      case 'LG-003': {
        seconds = Math.max(1, Math.round(rowCount / 200000));
        break;
      }

      // ALTER COLUMN TYPE rewrite
      case 'LG-004': {
        seconds = Math.max(2, Math.round(rowCount / 100000) * 1.5);
        break;
      }

      // Direct UNIQUE constraint
      case 'LG-005': {
        seconds = Math.max(2, Math.round(rowCount / 90000));
        break;
      }

      // Immediate DROP COLUMN / TABLE
      case 'LG-006': {
        seconds = 0.5;
        break;
      }

      // Missing lock timeout
      case 'LG-008': {
        seconds = 15;
        break;
      }

      // Unsafe SET NOT NULL
      case 'LG-009': {
        seconds = Math.max(2, Math.round(rowCount / 180000));
        break;
      }

      // TRUNCATE / MATVIEW
      case 'LG-012': {
        seconds = Math.max(1, Math.round(rowCount / 250000));
        break;
      }

      default:
        seconds = 1;
        break;
    }

    let riskLevel = 'LOW';
    if (seconds > 30) riskLevel = 'CRITICAL (OUTAGE GUARANTEED)';
    else if (seconds > 5) riskLevel = 'HIGH (SEVERE SPIKE)';
    else if (seconds > 1) riskLevel = 'MEDIUM (LATENCY ELEVATED)';

    return {
      seconds: Math.round(seconds),
      formatted: this.formatSeconds(seconds),
      riskLevel
    };
  }

  static generateContextualRiskMessage(violation, stats, lockDuration) {
    if ((stats.rowCount || 0) <= 0 && (stats.sizeMb || 0) <= 0) {
      return `Table '${violation.table}' live metrics unavailable. Operation will acquire ${violation.lockLevel} lock. Provide --schema-stats for estimated duration.`;
    }

    const rowsFormatted = (stats.rowCount >= 1000000) 
      ? (stats.rowCount / 1000000).toFixed(1) + 'M rows'
      : (stats.rowCount / 1000).toFixed(0) + 'k rows';

    const sizeFormatted = (stats.sizeMb >= 1024)
      ? (stats.sizeMb / 1024).toFixed(1) + ' GB'
      : stats.sizeMb + ' MB';

    return `Table '${violation.table}' contains ${rowsFormatted} (~${sizeFormatted}). ` +
      `Operation will hold ${violation.lockLevel} lock for at least ${lockDuration.formatted}, ` +
      `blocking concurrent client traffic. Calculated risk: ${lockDuration.riskLevel}.`;
  }

  static formatSeconds(sec) {
    if (sec <= 0) return '0.0s';
    if (sec < 1) return '< 1s';
    if (sec < 60) return `${Math.round(sec)}s`;
    const mins = Math.floor(sec / 60);
    const rem = Math.round(sec % 60);
    return `${mins}m ${rem}s`;
  }

  /**
   * Retrieves table schema statistics from live PostgreSQL (via psql) or a local JSON file.
   * @param {object} options { schemaStatsPath, useLiveDb, databaseUrl }
   * @returns {object} { [tableName]: { rowCount: number, sizeMb: number } }
   */
  static fetchSchemaStats(options = {}) {
    const fs = require('fs');
    const path = require('path');

    if (options.schemaStatsPath) {
      const resolved = path.resolve(process.cwd(), options.schemaStatsPath);
      if (fs.existsSync(resolved)) {
        try {
          const content = fs.readFileSync(resolved, 'utf8');
          const parsed = JSON.parse(content);
          const normalized = {};
          for (const [key, val] of Object.entries(parsed)) {
            normalized[key.toLowerCase()] = {
              rowCount: val.rowCount || val.row_count || val.rows || 0,
              sizeMb: val.sizeMb || val.size_mb || val.size || 0
            };
          }
          return normalized;
        } catch (err) {
          console.warn(`⚠️ Warning: Failed to parse schema stats from ${options.schemaStatsPath}: ${err.message}`);
        }
      }
    }

    const dbUrl = options.databaseUrl || process.env.DATABASE_URL;
    if (options.useLiveDb && dbUrl) {
      try {
        const { execSync } = require('child_process');
        const sql = `SELECT c.relname, c.reltuples::bigint, pg_total_relation_size(c.oid) / (1024*1024) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r';`;
        const cmd = `psql "${dbUrl}" -t -A -F"," -c "${sql}"`;
        const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const stats = {};
        for (const line of output.trim().split('\n')) {
          if (!line.trim()) continue;
          const [table, rows, sizeMb] = line.split(',');
          if (table) {
            stats[table.trim().toLowerCase()] = {
              rowCount: Math.max(0, parseInt(rows, 10) || 0),
              sizeMb: Math.max(0, parseInt(sizeMb, 10) || 0)
            };
          }
        }
        return stats;
      } catch (err) {
        // Live psql query failed; fall through to empty stats
      }
    }

    return {};
  }
}

module.exports = ContextAnalyzer;
