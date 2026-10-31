const { createHash } = require('node:crypto');
function findings(result) {
  return result.violations.map(v => ({
    fingerprint: createHash('sha256').update(JSON.stringify([v.ruleId, v.table, v.column || null, v.columns || [], v.indexName || null, v.constraintName || null, v.foreignTable || null, v.newType || null, v.severity, v.lockLevel])).digest('hex'),
    ruleId: v.ruleId, ruleName: v.ruleName, severity: v.severity, table: v.table, line: v.line, message: v.message
  }));
}
function compare(before, after) {
  if (before.findingsVersion !== 1 || after.findingsVersion !== 1) throw Object.assign(new Error('В старой проверке нет данных для сравнения. Выполните новую проверку.'), { statusCode: 409 });
  if (before.analysisComplete === false || after.analysisComplete === false) throw Object.assign(new Error('Неполный анализ нельзя использовать для вывода об устранении замечаний.'), { statusCode: 409 });
  const pool = before.findings.map(f => ({ ...f })), introduced = [], persisting = [];
  for (const item of after.findings) {
    const index = pool.findIndex(f => f.fingerprint === item.fingerprint);
    if (index === -1) introduced.push(item);
    else { persisting.push(item); pool.splice(index, 1); }
  }
  const info = run => ({ id: run.id, filename: run.filename, timestamp: run.timestamp, schemaId: run.schemaId, schemaRevision: run.schemaRevision, violationsCount: run.violationsCount });
  return { before: info(before), after: info(after), introduced, persisting, resolved: pool,
    contextChanged: (before.schemaRevision || null) !== (after.schemaRevision || null),
    differentFiles: before.filename !== after.filename };
}
module.exports = { findings, compare };
