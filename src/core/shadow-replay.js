/**
 * LockGuard Shadow Replay Simulation Engine
 * Illustrative arithmetic scenario. Does not execute SQL or measure a database.
 */

class ShadowReplaySimulator {
  /**
   * Runs a simulated lock contention benchmark against an AST analysis.
   * @param {object} analysis
   * @param {object} options { simulatedRows, concurrentRps }
   */
  static simulate(analysis, options = {}) {
    const parameter = (key, fallback, min, max) => {
      const value = options[key] ?? fallback;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw Object.assign(new Error(`${key} must be a finite number between ${min} and ${max}`), { statusCode: 400 });
      }
      return value;
    };
    const rows = parameter('simulatedRows', 50000, 0, 1e12);
    const rps = parameter('concurrentRps', 250, 0, 1e7);
    const poolSize = parameter('pgBouncerPoolSize', 100, 1, 1e6);
    const cpuCores = parameter('cpuCores', 8, 1, 1e5);

    const simulationResults = [];
    const unmodeledFindings = [];
    let totalContentionMs = 0;

    // Uncalibrated Poisson-arrival illustration, not an M/M/c benchmark.
    const avgQueryDurationSec = 0.004; // 4ms average reader duration
    const tableTrafficRps = rps * 0.45; // ~45% of app queries hit this core table
    const coreContentionFactor = Math.max(1, (rps / (cpuCores * 100)));
    const effectiveInFlight = tableTrafficRps * (avgQueryDurationSec * coreContentionFactor);
    const lockContentionProb = rows === 0 ? 0 : Math.min(99.9, (1 - Math.exp(-effectiveInFlight)) * 100);

    for (const v of analysis.violations) {
      if(v.ruleId==='LG-004'&&v.rewrite!=='required') {unmodeledFindings.push({ruleId:v.ruleId,table:v.table,reason:'Source-dependent type change: runtime lock waits are not modeled.'});continue;}
      let baseDelayMs = 0;
      let blockedQueriesCount = 0;

      switch (v.ruleId) {
        case 'LG-001': // volatile default rewrite
          baseDelayMs = Math.round((rows / 1000) * 12); // ~600ms on 50k
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * rps);
          break;

        case 'LG-002': // non-concurrent index
          baseDelayMs = Math.round((rows / 1000) * 8); // ~400ms on 50k
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * (rps * 0.4)); // write queries
          break;

        case 'LG-003': // FK scan
          baseDelayMs = Math.round((rows / 1000) * 5); // ~250ms on 50k
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * rps);
          break;

        case 'LG-004': // column type rewrite
          baseDelayMs = Math.round((rows / 1000) * 15); // ~750ms on 50k
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * rps);
          break;

        default:
          baseDelayMs = Math.round((rows / 1000) * 2);
          blockedQueriesCount = Math.round((baseDelayMs / 1000) * rps);
          break;
      }

      totalContentionMs += baseDelayMs;

      simulationResults.push({
        table: v.table,
        ruleId: v.ruleId,
        lockLevel: v.lockLevel,
        simulatedContentionMs: baseDelayMs,
        blockedQueriesEstimated: blockedQueriesCount,
        verdict: baseDelayMs > 100 ? 'UNACCEPTABLE_LATENCY_SPIKE' : 'TOLERABLE'
      });
    }

    const timeToExhaustSec = rps === 0 ? null : Number((poolSize / rps).toFixed(2));
    const isPoolExhausted = rps > 0 && totalContentionMs > (poolSize / rps * 1000);

    let outageSeverity = 'NONE';
    if (rps === 0 || rows === 0) {
      outageSeverity = 'NONE';
    } else if (isPoolExhausted || totalContentionMs >= 1000) {
      outageSeverity = 'CATASTROPHIC';
    } else if (totalContentionMs >= 300) {
      outageSeverity = 'HIGH';
    } else if (totalContentionMs > 0) {
      outageSeverity = 'MODERATE';
    }

    return {
      modelVersion: 2,
      measured: false,
      assessmentStatus: analysis.analysisComplete === false ? 'incomplete' : unmodeledFindings.length ? 'insufficient_context' : analysis.violations.length ? 'scenario' : 'no-findings',
      unmodeledFindings,
      actualDowntimeSec: null,
      actualLockWaitSec: null,
      lockHoldingDurationSec: null,
      assumptions: { averageQueryDurationMs: 4, tableTrafficShare: 0.45, calibrated: false,
        poolModel: 'All arriving requests occupy one connection; no service completions are modeled.' },
      limitations: 'Uncalibrated scenario, not a database measurement or a downtime forecast. Lock waits, transaction boundaries, data types, storage and application retries require separate verification. No findings does not prove zero downtime.',
      simulatedRows: rows,
      simulatedConcurrentRps: rps,
      pgBouncerPoolSize: poolSize,
      cpuCores,
      lockContentionProbability: Number(lockContentionProb.toFixed(1)),
      timeToPoolExhaustionSec: timeToExhaustSec,
      isPoolExhausted,
      outageSeverity,
      poolExhaustionWarning: isPoolExhausted
        ? `In this simplified scenario the pool limit is reached after ${timeToExhaustSec}s. Actual queueing and errors depend on connection use, timeouts and retries.`
        : rps === 0 ? 'No arriving requests in this scenario; time to pool exhaustion is not applicable.'
        : 'The pool limit is not reached in this simplified scenario. This is not a capacity guarantee.',
      totalLockWaitContentionMs: totalContentionMs,
      totalBlockedQueriesEstimated: simulationResults.reduce((acc, s) => acc + s.blockedQueriesEstimated, 0),
      tableSimulations: simulationResults,
      summary: `Illustrative scenario: ${rows.toLocaleString()} rows, ${rps} RPS; modeled operation cost ${totalContentionMs}ms and ~${simulationResults.reduce((acc, s) => acc + s.blockedQueriesEstimated, 0)} affected requests. SQL was not executed. Actual downtime and lock waits are unknown.`
    };
  }
}

module.exports = ShadowReplaySimulator;
