#!/usr/bin/env node

/**
 * LockGuard Commercial Audit Report Generator
 * Generates an executive-level, client-ready Zero-Downtime Migration Audit Report
 * for B2B consulting engagements ($300 - $1,500 / audit).
 */

const fs = require('fs');
const path = require('path');
const { RuleEngine } = require('../src/core');

function generateClientAuditReport(clientName, migrationsDir, outputFile) {
  const engine = new RuleEngine();
  const dir = path.resolve(process.cwd(), migrationsDir);

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const files = [];
  function scan(current) {
    for (const item of fs.readdirSync(current)) {
      const full = path.join(current, item);
      if (fs.statSync(full).isDirectory() && item !== 'node_modules') {
        scan(full);
      } else if (item.endsWith('.sql')) {
        files.push(full);
      }
    }
  }
  scan(dir);

  const results = files.map(file => {
    const rel = path.relative(process.cwd(), file);
    const sql = fs.readFileSync(file, 'utf8');
    return engine.analyze(sql, { filename: rel });
  });

  const totalViolations = results.reduce((acc, r) => acc + r.violationsCount, 0);
  const totalCritical = results.reduce((acc, r) => acc + r.criticalCount, 0);
  const totalHigh = results.reduce((acc, r) => acc + r.highCount, 0);
  const affectedTables = Array.from(new Set(results.flatMap(r => r.affectedTables)));

  const md = [];
  md.push(`# 🛡️ LockGuard Production Readiness Audit Report`);
  md.push(`**Prepared for:** ${clientName}`);
  md.push(`**Audit Date:** ${new Date().toLocaleDateString('ru-RU')} | **Auditor:** LockGuard Security & Performance Team`);
  md.push(`**Target RDBMS:** PostgreSQL 12 - 17+ | **High Availability SLA:** 99.99%`);
  md.push(``);
  md.push(`---`);
  md.push(``);
  md.push(`## 1. Executive Summary`);
  md.push(``);

  if (totalCritical > 0) {
    md.push(`> ⚠️ **CRITICAL RISK LEVEL: PRODUCTION OUTAGE IMMINENT UNDER LOAD**`);
    md.push(`> В ходе аудита миграций обнаружено **${totalCritical} критических антипаттернов блокировок** (\`ACCESS EXCLUSIVE\`), способных вызвать полную деградацию базы данных и 504 Gateway Timeout в период пиковых нагрузок.`);
  } else {
    md.push(`> ✅ **EXCELLENT: MIGRATIONS ARE ZERO-DOWNTIME COMPLIANT**`);
    md.push(`> Миграции соответствуют стандартам неблокирующего DDL PostgreSQL.`);
  }

  md.push(``);
  md.push(`### Ключевые метрики аудита:`);
  md.push(`* **Проверено миграционных скриптов:** \`${results.length}\``);
  md.push(`* **Критических блокировок (ACCESS EXCLUSIVE):** \`${totalCritical}\``);
  md.push(`* **Блокировок записи (SHARE LOCK):** \`${totalHigh}\``);
  md.push(`* **Затронутых таблиц базы данных:** \`${affectedTables.length}\` (${affectedTables.map(t => '`' + t + '`').join(', ')})`);
  md.push(``);
  md.push(`---`);
  md.push(``);
  md.push(`## 2. Матрица рисков и детальный план исправлений`);
  md.push(``);

  results.forEach((r, idx) => {
    if (r.violations.length === 0) return;
    md.push(`### 📄 Файл: \`${r.filename}\``);
    md.push(`* **Максимальный уровень блокировки:** \`${r.highestLockLevel}\``);
    md.push(`* **Нарушений:** ${r.violationsCount}`);
    md.push(``);

    r.violations.forEach((v, vIdx) => {
      md.push(`#### Нарушение #${vIdx + 1}: ${v.ruleName} (${v.severity})`);
      md.push(`* **Таблица:** \`${v.table}\` (Строка ${v.line})`);
      md.push(`* **Угроза для бизнеса:** ${v.message}`);
      if (v.safeFix) {
        md.push(``);
        md.push(`**Рекомендуемый Zero-Downtime SQL-паттерн:**`);
        md.push('```sql');
        md.push(v.safeFix);
        md.push('```');
      }
      md.push(``);
    });
  });

  md.push(`---`);
  md.push(`## 3. Рекомендации по интеграции в CI/CD`);
  md.push(`Для предотвращения повторного попадания блокирующих миграций в основную ветку, рекомендуется подключить постоянный гейткипер в GitHub Actions:`);
  md.push('```yaml');
  md.push(`- uses: Mars444456/lockguard@v1`);
  md.push(`  with:`);
  md.push(`    migrations_dir: '${migrationsDir}'`);
  md.push('```');
  md.push(``);
  md.push(`*Отчет сформирован с помощью LockGuard Enterprise Engine.*`);

  const reportText = md.join('\n');
  const targetPath = path.resolve(process.cwd(), outputFile || 'AUDIT_REPORT_CLIENT.md');
  fs.writeFileSync(targetPath, reportText, 'utf8');

  console.log(`\n✔ Commercial Audit Report successfully generated at: ${targetPath}`);
  console.log(`  Target: ${clientName}`);
  console.log(`  Violations: ${totalViolations} (${totalCritical} Critical, ${totalHigh} High)`);
}

const args = process.argv.slice(2);
const client = args[0] || 'Acme E-Commerce Corp';
const dir = args[1] || 'fixtures';
const out = args[2] || 'COMMERCIAL_AUDIT_REPORT.md';

generateClientAuditReport(client, dir, out);
