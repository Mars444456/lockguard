/**
 * LockGuard GitHub Pages Client Application
 * Powered 100% in-browser by LockGuard AST Engine
 */

const PRESETS = {
  catastrophic: `-- Catastrophic Real-World E-Commerce PR Migration
-- Warning: Missing SET lock_timeout!
BEGIN;

-- 1. Blocking Index Creation (takes SHARE lock on transactions)
CREATE INDEX idx_transactions_created_at ON transactions (created_at);

-- 2. Heavy ADD COLUMN with volatile DEFAULT (full table rewrite!)
ALTER TABLE accounts ADD COLUMN updated_at TIMESTAMP DEFAULT now() NOT NULL;

-- 3. Unvalidated Foreign Key (scans millions of rows under lock)
ALTER TABLE transactions 
  ADD CONSTRAINT fk_tx_account 
  FOREIGN KEY (account_id) 
  REFERENCES accounts(id);

-- 4. Full Table Rewrite
ALTER TABLE transactions ALTER COLUMN amount TYPE NUMERIC(18, 4);

-- 5. Direct Unique Constraint
ALTER TABLE accounts ADD CONSTRAINT uq_account_iban UNIQUE (iban);

-- 6. Direct DROP COLUMN (breaks running instances)
ALTER TABLE accounts DROP COLUMN legacy_pin;

COMMIT;`,

  add_column: `-- Unsafe ADD COLUMN with volatile default (full table rewrite)
SET lock_timeout = '3s';

ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT now() NOT NULL;
ALTER TABLE payments ADD COLUMN transaction_token UUID DEFAULT gen_random_uuid();`,

  blocking_index: `-- Blocking non-concurrent CREATE INDEX
SET lock_timeout = '3s';

CREATE INDEX idx_users_email ON users (email);
CREATE UNIQUE INDEX idx_orders_reference ON orders (reference_number);`,

  unsafe_fk: `-- Heavy Foreign Key scan without NOT VALID
SET lock_timeout = '3s';

ALTER TABLE order_items 
  ADD CONSTRAINT fk_order_items_product 
  FOREIGN KEY (product_id) 
  REFERENCES products(id);`,

  alter_type: `-- Heavy column type change requiring rewrite
SET lock_timeout = '3s';

ALTER TABLE invoices ALTER COLUMN amount TYPE BIGINT;
ALTER TABLE user_profiles ALTER COLUMN bio TYPE VARCHAR(255);`,

  direct_unique: `-- Direct unique constraint without concurrent index
SET lock_timeout = '3s';

ALTER TABLE users ADD CONSTRAINT uq_users_tax_id UNIQUE (tax_id);`,

  missing_timeout: `-- Missing SET lock_timeout directive (Head-of-Line Blocking risk!)
ALTER TABLE orders ADD COLUMN notes TEXT;`,

  safe_migration: `-- 100% Zero-Downtime Safe PostgreSQL Migration
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Step 1: Concurrent non-blocking index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_status ON accounts (status);

-- Step 2: Instant catalog update (Postgres 11+ metadata)
ALTER TABLE accounts ADD COLUMN is_verified BOOLEAN DEFAULT true;

-- Step 3: Foreign Key in two safe phases (Not blocking)
ALTER TABLE transactions 
  ADD CONSTRAINT fk_tx_account_safe 
  FOREIGN KEY (account_id) 
  REFERENCES accounts(id) 
  NOT VALID;

-- Step 4: Validate existing data under weak lock
ALTER TABLE transactions VALIDATE CONSTRAINT fk_tx_account_safe;`
};

class LockGuardWebPlayground {
  constructor() {
    this.sqlInput = document.getElementById('sql-input');
    this.presetSelect = document.getElementById('preset-select');
    this.btnExportPdf = document.getElementById('btn-export-pdf');
    this.btnAnalyze = document.getElementById('btn-analyze');
    this.btnSplit = document.getElementById('btn-split');
    this.btnClear = document.getElementById('btn-clear-sql');
    
    this.sliderRows = document.getElementById('slider-rows');
    this.valRows = document.getElementById('val-rows');
    this.sliderRps = document.getElementById('slider-rps');
    this.valRps = document.getElementById('val-rps');
    this.sliderPool = document.getElementById('slider-pool');
    this.valPool = document.getElementById('val-pool');
    this.sliderGmv = document.getElementById('slider-gmv');
    this.valGmv = document.getElementById('val-gmv');

    this.verdictBadge = document.getElementById('verdict-badge');
    this.emptyState = document.getElementById('empty-state');
    this.analysisDetails = document.getElementById('analysis-details');
    this.splitterPanel = document.getElementById('splitter-panel');
    this.dmlNotice = document.getElementById('dml-notice');
    this.dmlDesc = document.getElementById('dml-desc');

    this.resMaxLock = document.getElementById('res-max-lock');
    this.resLockSub = document.getElementById('res-lock-sub');
    this.resViolationsCount = document.getElementById('res-violations-count');
    this.resViolationsSub = document.getElementById('res-violations-sub');
    this.resDowntime = document.getElementById('res-downtime');
    this.resDowntimeSub = document.getElementById('res-downtime-sub');
    this.resBlockedQueries = document.getElementById('res-blocked-queries');
    this.resPoolTime = document.getElementById('res-pool-time');
    this.resPoolSub = document.getElementById('res-pool-sub');
    this.resFinancialLoss = document.getElementById('res-financial-loss');
    this.resFinancialSub = document.getElementById('res-financial-sub');

    this.btnShare = document.getElementById('btn-share');
    this.btnCopyBadge = document.getElementById('btn-copy-badge');

    this.violationsList = document.getElementById('violations-list');
    this.splitterPhases = document.getElementById('splitter-phases');

    this.currentOrm = 'sql';
    this.lastAnalysis = null;

    this.initEventListeners();
    
    // Check if permalink SQL is provided via URL hash
    const hash = window.location.hash;
    if (hash && hash.startsWith('#sql=')) {
      try {
        const decoded = decodeURIComponent(hash.substring(5));
        if (decoded && decoded.trim()) {
          this.sqlInput.value = decoded;
          setTimeout(() => this.runAnalysis(), 100);
        } else {
          this.loadPreset('catastrophic');
        }
      } catch (err) {
        this.loadPreset('catastrophic');
      }
    } else {
      this.loadPreset('catastrophic');
    }
  }

  initEventListeners() {
    this.presetSelect.addEventListener('change', (e) => this.loadPreset(e.target.value));
    this.btnAnalyze.addEventListener('click', () => this.runAnalysis());
    this.btnSplit.addEventListener('click', () => this.runSplitter());
    if (this.btnExportPdf) {
      this.btnExportPdf.addEventListener('click', () => this.exportPdfReport());
    }
    this.btnClear.addEventListener('click', () => {
      this.sqlInput.value = '';
      this.showEmptyState();
    });

    this.sliderRows.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      const formatted = val >= 1000000 
        ? (val / 1000000).toFixed(1) + 'M строк (~' + (val * 0.0006).toFixed(1) + ' GB)'
        : (val / 1000).toFixed(0) + 'K строк';
      this.valRows.textContent = formatted;
      if (this.lastAnalysis) this.runAnalysis();
    });

    this.sliderRps.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.valRps.textContent = val + ' RPS';
      if (this.lastAnalysis) this.runAnalysis();
    });

    if (this.sliderPool) {
      this.sliderPool.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.valPool.textContent = val + ' коннектов';
        if (this.lastAnalysis) this.runAnalysis();
      });
    }

    if (this.sliderGmv) {
      this.sliderGmv.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        const formatted = val >= 1000000 
          ? (val / 1000000).toFixed(1) + 'M ₽ / день'
          : (val / 1000).toFixed(0) + 'K ₽ / день';
        this.valGmv.textContent = formatted;
        if (this.lastAnalysis) this.runAnalysis();
      });
    }

    if (this.btnShare) {
      this.btnShare.addEventListener('click', () => {
        const sql = this.sqlInput.value.trim();
        if (!sql) return;
        const url = `${window.location.origin}${window.location.pathname}#sql=${encodeURIComponent(sql)}`;
        navigator.clipboard.writeText(url).then(() => {
          const originalText = this.btnShare.textContent;
          this.btnShare.textContent = '✔ Ссылка скопирована!';
          this.btnShare.style.borderColor = '#10B981';
          this.btnShare.style.color = '#34D399';
          setTimeout(() => {
            this.btnShare.textContent = originalText;
            this.btnShare.style.borderColor = '';
            this.btnShare.style.color = '';
          }, 2500);
        });
      });
    }

    if (this.btnCopyBadge) {
      this.btnCopyBadge.addEventListener('click', () => {
        const badgeMd = '[![Protected by LockGuard](https://img.shields.io/badge/PostgreSQL-Zero--Downtime_Protected-10B981?style=flat-square&logo=postgresql&logoColor=white)](https://github.com/Mars444456/lockguard)';
        navigator.clipboard.writeText(badgeMd).then(() => {
          this.btnCopyBadge.textContent = '✔ Markdown скопирован!';
          setTimeout(() => {
            this.btnCopyBadge.textContent = '📋 Скопировать Markdown';
          }, 2500);
        });
      });
    }

    this.sqlInput.addEventListener('input', () => {
      // Auto-analyze on typing after 300ms
      clearTimeout(this.typeTimer);
      this.typeTimer = setTimeout(() => {
        if (this.sqlInput.value.trim()) {
          this.runAnalysis();
        } else {
          this.showEmptyState();
        }
      }, 350);
    });

    // Auto-splitter ORM tabs
    document.querySelectorAll('.splitter-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.splitter-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentOrm = e.target.dataset.orm;
        this.renderSplitterPhases();
      });
    });
  }

  loadPreset(key) {
    if (PRESETS[key]) {
      this.sqlInput.value = PRESETS[key];
      this.runAnalysis();
    }
  }

  showEmptyState() {
    this.emptyState.classList.remove('hidden');
    this.analysisDetails.classList.add('hidden');
    this.splitterPanel.classList.add('hidden');
    this.verdictBadge.className = 'verdict-pill pending';
    this.verdictBadge.textContent = 'Awaiting Analysis';
  }

  runAnalysis() {
    const sql = this.sqlInput.value.trim();
    if (!sql) {
      this.showEmptyState();
      return;
    }

    if (!window.LockGuard) {
      alert('LockGuard Engine is still loading. Please wait 1 second.');
      return;
    }

    const rows = parseInt(this.sliderRows.value, 10);
    const rps = parseInt(this.sliderRps.value, 10);
    const poolSize = this.sliderPool ? parseInt(this.sliderPool.value, 10) : 100;

    // 1. Analyze AST
    const analysis = window.LockGuard.analyze(sql);
    this.lastAnalysis = analysis;

    // 2. Simulate Latency & Blocked Queries
    const simulation = window.LockGuard.simulate(analysis, { 
      simulatedRows: rows, 
      concurrentRps: rps,
      pgBouncerPoolSize: poolSize 
    });

    // 3. Render Results
    this.emptyState.classList.add('hidden');
    this.analysisDetails.classList.remove('hidden');

    this.renderVerdict(analysis);
    this.renderMetrics(analysis, simulation, rows);
    this.renderLockMatrix(analysis.highestLockLevel);
    this.renderViolations(analysis.violations);
  }

  renderVerdict(analysis) {
    if (analysis.isDmlOnly) {
      this.verdictBadge.className = 'verdict-pill passed';
      this.verdictBadge.innerHTML = '✔ DML / ЧТЕНИЕ ДАННЫХ (БЛОКИРОВОК НЕТ)';
    } else if (analysis.passed) {
      this.verdictBadge.className = 'verdict-pill passed';
      this.verdictBadge.innerHTML = '✔ 100% ZERO-DOWNTIME SAFE';
    } else {
      this.verdictBadge.className = 'verdict-pill failed';
      this.verdictBadge.innerHTML = `✖ CI RELEASE BLOCKED (${analysis.criticalCount} Critical)`;
    }
  }

  renderMetrics(analysis, simulation, rows) {
    if (analysis.isDmlOnly) {
      if (this.dmlNotice) {
        this.dmlNotice.classList.remove('hidden');
        this.dmlDesc.textContent = analysis.dmlDescription;
      }
      this.resMaxLock.textContent = 'ACCESS SHARE (READ)';
      this.resMaxLock.className = 'metric-value text-emerald';
      this.resLockSub.textContent = 'Обычное чтение/запись данных (DML)';
      this.resViolationsCount.textContent = '0';
      this.resViolationsSub.textContent = 'Нет DDL-операций';
      this.resDowntime.textContent = '0.0s';
      this.resDowntime.className = 'metric-value text-emerald';
      this.resDowntimeSub.textContent = 'Простой отсутствует';
      this.resBlockedQueries.textContent = '0';
      this.resBlockedQueries.className = 'metric-value text-emerald';
      if (this.resPoolTime) {
        this.resPoolTime.textContent = 'Безопасно';
        this.resPoolTime.className = 'metric-value text-emerald';
        this.resPoolSub.textContent = 'Пул не забивается';
      }
      if (this.resFinancialLoss) {
        this.resFinancialLoss.textContent = '0 ₽';
        this.resFinancialLoss.className = 'metric-value text-emerald';
        this.resFinancialSub.textContent = 'Потери бизнеса отсутствуют';
      }
      return;
    }

    if (this.dmlNotice) {
      this.dmlNotice.classList.add('hidden');
    }

    this.resMaxLock.textContent = analysis.highestLockLevel || 'ACCESS SHARE';
    if (analysis.highestLockLevel === 'ACCESS EXCLUSIVE') {
      this.resMaxLock.className = 'metric-value text-red';
      this.resLockSub.textContent = 'Freezes whole table (even SELECTs)';
    } else if (analysis.highestLockLevel === 'SHARE') {
      this.resMaxLock.className = 'metric-value text-amber';
      this.resLockSub.textContent = 'Blocks all INSERT, UPDATE, DELETE';
    } else {
      this.resMaxLock.className = 'metric-value text-emerald';
      this.resLockSub.textContent = 'Non-blocking concurrent safe';
    }

    this.resViolationsCount.textContent = analysis.violationsCount;
    this.resViolationsSub.textContent = `${analysis.criticalCount} Critical, ${analysis.highCount} High`;

    const delayMs = simulation.totalLockWaitContentionMs;
    const estSec = (delayMs / 1000).toFixed(1);
    this.resDowntime.textContent = `${estSec}s`;
    this.resDowntime.className = delayMs > 1000 ? 'metric-value text-red' : (delayMs > 0 ? 'metric-value text-amber' : 'metric-value text-emerald');
    this.resDowntimeSub.textContent = `On ${(rows / 1000000).toFixed(1)}M rows table`;

    this.resBlockedQueries.textContent = `~${simulation.totalBlockedQueriesEstimated.toLocaleString()}`;
    this.resBlockedQueries.className = simulation.totalBlockedQueriesEstimated > 100 ? 'metric-value text-cyan' : 'metric-value text-emerald';

    if (this.resPoolTime) {
      this.resPoolTime.textContent = `${simulation.timeToPoolExhaustionSec}s`;
      this.resPoolTime.className = simulation.isPoolExhausted ? 'metric-value text-amber' : 'metric-value text-emerald';
      this.resPoolSub.textContent = simulation.isPoolExhausted ? '⚠️ Пул будет исчерпан!' : 'В пределах нормы';
    }

    if (this.resFinancialLoss) {
      const gmv = this.sliderGmv ? parseInt(this.sliderGmv.value, 10) : 1000000;
      const lossPerSec = gmv / 86400;
      const directLoss = lossPerSec * (delayMs / 1000);
      const dropoffCost = simulation.isPoolExhausted 
        ? Math.min(simulation.totalBlockedQueriesEstimated * 20, gmv * 0.15) 
        : (simulation.totalBlockedQueriesEstimated * 5);
      const totalLossRub = Math.round(directLoss + dropoffCost);
      const approxUsd = Math.round(totalLossRub / 95);

      if (totalLossRub > 0) {
        this.resFinancialLoss.textContent = `~${totalLossRub.toLocaleString('ru-RU')} ₽`;
        this.resFinancialLoss.className = totalLossRub > 30000 ? 'metric-value text-red' : 'metric-value text-amber';
        this.resFinancialSub.textContent = `≈ $${approxUsd.toLocaleString('en-US')} отток клиентов`;
      } else {
        this.resFinancialLoss.textContent = '0 ₽';
        this.resFinancialLoss.className = 'metric-value text-emerald';
        this.resFinancialSub.textContent = 'Потери бизнеса отсутствуют';
      }
    }
  }

  renderLockMatrix(highestLock) {
    const isAccessExclusive = highestLock === 'ACCESS EXCLUSIVE';
    const isShare = highestLock === 'SHARE' || isAccessExclusive;

    this.updateMatrixItem('matrix-select', isAccessExclusive);
    this.updateMatrixItem('matrix-insert', isShare);
    this.updateMatrixItem('matrix-update', isShare);
    this.updateMatrixItem('matrix-delete', isShare);
  }

  updateMatrixItem(id, isBlocked) {
    const el = document.getElementById(id);
    if (!el) return;
    if (isBlocked) {
      el.className = 'matrix-item blocked';
      el.querySelector('.matrix-status').textContent = '⛔ BLOCKED';
    } else {
      el.className = 'matrix-item allowed';
      el.querySelector('.matrix-status').textContent = '✔ ALLOWED';
    }
  }

  renderViolations(violations) {
    this.violationsList.innerHTML = '';
    if (!violations || violations.length === 0) {
      this.violationsList.innerHTML = '<div style="color:var(--accent-emerald); font-size:0.85rem; padding:0.5rem 0;">✔ No dangerous table lock anti-patterns detected.</div>';
      return;
    }

    violations.forEach((v, idx) => {
      const card = document.createElement('div');
      card.className = `violation-card ${v.severity.toLowerCase()}`;
      card.innerHTML = `
        <div class="violation-header">
          <div class="violation-title">#${idx + 1}. ${v.ruleName} (<code>${v.ruleId}</code>)</div>
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            ${v.isPhysicalTableRewrite ? '<span style="background:rgba(239,68,68,0.2); color:#F87171; border:1px solid rgba(239,68,68,0.4); padding:2px 6px; border-radius:4px; font-size:11px; font-weight:700;">💾 Рерайт диска</span>' : ''}
            ${v.rewriteReason === 'FAST_DEFAULT_METADATA_ONLY' ? '<span style="background:rgba(6,182,212,0.2); color:#22D3EE; border:1px solid rgba(6,182,212,0.4); padding:2px 6px; border-radius:4px; font-size:11px; font-weight:700;">⚡ Fast Default (Метаданные)</span>' : ''}
            <span class="badge-sev ${v.severity.toLowerCase()}">${v.severity} • ${v.lockLevel}</span>
          </div>
        </div>
        <div class="violation-msg">
          <b>Table:</b> <code>${v.table || 'unknown'}</code> | <b>Line:</b> L${v.line || '1'}
          <br>${v.message}
        </div>
        ${v.safeFix ? `
          <div class="safe-fix-box">
            <div class="safe-fix-header">
              <span>💡 Zero-Downtime Safe Fix</span>
              <button class="btn-secondary btn-xs btn-copy-fix">Copy Fix</button>
            </div>
            <pre class="safe-fix-code">${v.safeFix}</pre>
          </div>
        ` : ''}
      `;

      const copyBtn = card.querySelector('.btn-copy-fix');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(v.safeFix);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => copyBtn.textContent = 'Copy Fix', 2000);
        });
      }

      this.violationsList.appendChild(card);
    });
  }

  runSplitter() {
    const sql = this.sqlInput.value.trim();
    if (!sql) return;

    if (!this.lastAnalysis) {
      this.runAnalysis();
    }

    this.splitterPanel.classList.remove('hidden');
    this.renderSplitterPhases();
    this.splitterPanel.scrollIntoView({ behavior: 'smooth' });
  }

  renderSplitterPhases() {
    if (!this.lastAnalysis) return;
    const plan = window.LockGuard.generatePlan(this.lastAnalysis, this.currentOrm);
    this.splitterPhases.innerHTML = '';

    if (!plan.phases || plan.phases.length === 0) {
      this.splitterPhases.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Migration is already safe. No multi-phase split required.</div>';
      return;
    }

    plan.phases.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'phase-card';
      const snippet = (plan.ormSnippets && plan.ormSnippets[idx]) 
        ? plan.ormSnippets[idx].code 
        : (p.sql || p.code || '');
      const instruction = (plan.ormSnippets && plan.ormSnippets[idx] && plan.ormSnippets[idx].instruction)
        ? `<div style="font-size:0.75rem; color:var(--accent-cyan); margin-bottom:0.4rem; font-family:monospace;">${plan.ormSnippets[idx].instruction}</div>`
        : '';
      card.innerHTML = `
        <div class="phase-title">📦 [PHASE ${p.phaseNumber || (idx + 1)}]: ${p.title}</div>
        <div class="phase-desc">${p.description}</div>
        ${instruction}
        <pre class="phase-code">${snippet}</pre>
      `;
      this.splitterPhases.appendChild(card);
    });
  }

  exportPdfReport() {
    this.runAnalysis();
    const analysis = this.lastAnalysis;
    if (!analysis) return;

    const rows = parseInt(this.sliderRows.value, 10);
    const rps = parseInt(this.sliderRps.value, 10);
    const poolSize = this.sliderPool ? parseInt(this.sliderPool.value, 10) : 100;
    const gmv = this.sliderGmv ? parseInt(this.sliderGmv.value, 10) : 1000000;
    const simulation = window.LockGuard.simulate(analysis, { 
      simulatedRows: rows, 
      concurrentRps: rps,
      pgBouncerPoolSize: poolSize 
    });
    const splitPlan = window.LockGuard.generatePlan(analysis, 'sql');

    const lossPerSec = gmv / 86400;
    const directLoss = lossPerSec * (simulation.totalLockWaitContentionMs / 1000);
    const dropoffCost = simulation.isPoolExhausted 
      ? Math.min(simulation.totalBlockedQueriesEstimated * 20, gmv * 0.15) 
      : (simulation.totalBlockedQueriesEstimated * 5);
    const totalLossRub = analysis.isDmlOnly ? 0 : Math.round(directLoss + dropoffCost);

    const formattedRows = rows >= 1000000 
      ? (rows / 1000000).toFixed(1) + 'M строк (~' + (rows * 0.0006).toFixed(1) + ' GB)'
      : (rows / 1000).toFixed(0) + 'K строк';

    const isSafe = analysis.passed;
    const dateStr = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const estDowntimeSec = (simulation.totalLockWaitContentionMs / 1000).toFixed(1);

    const violationsHtml = (analysis.violations || []).map((v, idx) => `
      <div style="border:1px solid #CBD5E1; border-left:4px solid ${v.severity === 'CRITICAL' ? '#DC2626' : '#D97706'}; border-radius:6px; padding:14px; margin-bottom:14px; background:#F8FAFC; page-break-inside:avoid;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <strong style="color:#0F172A; font-size:15px;">#${idx + 1}. ${v.ruleName} (<code>${v.ruleId}</code>)</strong>
          <span style="background:${v.severity === 'CRITICAL' ? '#FEE2E2' : '#FEF3C7'}; color:${v.severity === 'CRITICAL' ? '#991B1B' : '#92400E'}; padding:2px 8px; border-radius:4px; font-weight:700; font-size:12px;">
            ${v.severity} • ${v.lockLevel}
          </span>
        </div>
        <div style="font-size:13px; color:#334155; margin-bottom:8px;">
          <b>Таблица:</b> <code>${v.table || 'default'}</code> | <b>Строка:</b> L${v.line || '1'}
          <br>${v.message}
        </div>
        ${v.safeFix ? `
          <div style="background:#0F172A; color:#E2E8F0; padding:10px 14px; border-radius:6px; font-family:Consolas, monospace; font-size:12px; line-height:1.5; white-space:pre-wrap;">
<span style="color:#38BDF8; font-weight:bold;">-- Безопасный альтернативный Zero-Downtime код:</span>
${v.safeFix}
          </div>
        ` : ''}
      </div>
    `).join('');

    const phasesHtml = (splitPlan.phases || []).map(p => `
      <div style="border:1px solid #E2E8F0; border-radius:6px; padding:12px; margin-bottom:10px; background:#F8FAFC; page-break-inside:avoid;">
        <div style="font-weight:700; color:#0F172A; font-size:14px; margin-bottom:4px;">📦 [ЭТАП ${p.phase}]: ${p.title}</div>
        <div style="font-size:12px; color:#475569; margin-bottom:8px;">${p.description}</div>
        <pre style="background:#0F172A; color:#4ADE80; padding:10px; border-radius:4px; font-family:Consolas, monospace; font-size:12px; line-height:1.4; margin:0; white-space:pre-wrap;">${p.code}</pre>
      </div>
    `).join('');

    const reportHtml = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>LockGuard Production Readiness Audit Report</title>
  <style>
    @page { margin: 15mm 20mm; size: A4; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0F172A; line-height: 1.5; margin: 0; padding: 20px; font-size: 13px; }
    .header { border-bottom: 2px solid #0F172A; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .title { font-size: 22px; font-weight: 800; color: #0F172A; margin: 0; }
    .subtitle { font-size: 13px; color: #475569; margin-top: 4px; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    .meta-table td { padding: 6px 10px; border: 1px solid #CBD5E1; }
    .meta-table td.label { font-weight: 700; background: #F1F5F9; width: 25%; color: #334155; }
    .banner { padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; border-left: 6px solid; }
    .banner.critical { background: #FEF2F2; border-color: #DC2626; color: #991B1B; }
    .banner.safe { background: #F0FDF4; border-color: #16A34A; color: #166534; }
    .banner-title { font-size: 16px; font-weight: 800; margin-bottom: 4px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
    .stat-box { border: 1px solid #CBD5E1; background: #F8FAFC; border-radius: 6px; padding: 10px; text-align: center; }
    .stat-label { font-size: 11px; text-transform: uppercase; color: #64748B; font-weight: 700; }
    .stat-val { font-size: 18px; font-weight: 800; color: #0F172A; font-family: Consolas, monospace; margin-top: 4px; }
    .stat-val.red { color: #DC2626; }
    h2 { font-size: 16px; font-weight: 800; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; margin-top: 24px; margin-bottom: 14px; color: #0F172A; }
    .footer { margin-top: 30px; border-top: 1px solid #CBD5E1; padding-top: 12px; font-size: 11px; color: #64748B; display: flex; justify-content: space-between; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body>
  <div class="no-print" style="background:#EFF6FF; border:1px solid #93C5FD; padding:12px; border-radius:6px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
    <span><b>Предварительный просмотр PDF:</b> Нажмите кнопку справа, чтобы сохранить официальный PDF-отчет или распечатать.</span>
    <button onclick="window.print()" style="background:#2563EB; color:#FFF; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer;">Сохранить как PDF</button>
  </div>

  <div class="header">
    <div>
      <h1 class="title">🛡️ LockGuard Production Readiness Audit</h1>
      <div class="subtitle">PostgreSQL DDL Lock Impact & Downtime Risk Assessment</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:700; font-size:12px;">Дата отчета: ${dateStr}</div>
      <div style="font-size:11px; color:#64748B;">SLA: 99.99% High Availability</div>
    </div>
  </div>

  <table class="meta-table">
    <tr>
      <td class="label">Объект аудита:</td>
      <td>Миграционный DDL-скрипт (PostgreSQL 11 – 17+)</td>
      <td class="label">Аудитор:</td>
      <td>LockGuard Automated AST Gatekeeper</td>
    </tr>
    <tr>
      <td class="label">Параметры прод-базы:</td>
      <td>Таблица: ${formattedRows} | Трафик: ${rps} RPS</td>
      <td class="label">Контакты команды:</td>
      <td>Telegram: <b>@marswwu</b> | GitHub: Mars444456/lockguard</td>
    </tr>
  </table>

  <div class="banner ${analysis.isDmlOnly ? 'safe' : (isSafe ? 'safe' : 'critical')}">
    <div class="banner-title">${analysis.isDmlOnly ? 'ℹ️ СТАТУС: DML ОПЕРАЦИЯ ДАННЫХ (БЛОКИРОВОК СХЕМЫ НЕТ)' : (isSafe ? '✅ СТАТУС: МИГРАЦИЯ БЕЗОПАСНА (ZERO-DOWNTIME COMPLIANT)' : '⚠️ СТАТУС: КРИТИЧЕСКИЙ РИСК ПРОСТОЯ ПРОДАКШЕНА (OUTAGE IMMINENT)')}</div>
    <div>${analysis.isDmlOnly 
      ? 'Запрос является операцией чтения/записи данных (SELECT / INSERT / UPDATE / DELETE). Структура и схема базы данных не изменяются, блокировок DDL нет. Расчетный простой базы: 0.0 сек.'
      : (isSafe 
        ? 'Анализ AST-дерева подтвердил: запрошенные операции не вызывают длительных эксклюзивных блокировок. Миграция безопасна для боевого деплоя под живым трафиком.' 
        : 'В миграционном скрипте обнаружены операции с блокировкой <b>ACCESS EXCLUSIVE</b>. Выкатка приведет к полной заморозке таблицы, накоплению очереди входящих транзакций и лавинообразным ошибкам 504 Gateway Timeout.')}</div>
  </div>

  <div class="stats-grid" style="grid-template-columns: repeat(6, 1fr);">
    <div class="stat-box">
      <div class="stat-label">Макс. Блокировка</div>
      <div class="stat-val ${analysis.highestLockLevel === 'ACCESS EXCLUSIVE' && !analysis.isDmlOnly ? 'red' : ''}">${analysis.isDmlOnly ? 'ACCESS SHARE' : (analysis.highestLockLevel || 'ACCESS SHARE')}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Расчетный простой</div>
      <div class="stat-val ${analysis.isDmlOnly ? '' : 'red'}">${analysis.isDmlOnly ? '0.0' : estDowntimeSec} сек</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Зависнет запросов</div>
      <div class="stat-val">${analysis.isDmlOnly ? '0' : simulation.totalBlockedQueriesEstimated.toLocaleString()}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Пул PgBouncer (${poolSize})</div>
      <div class="stat-val ${simulation.isPoolExhausted && !analysis.isDmlOnly ? 'red' : ''}">${analysis.isDmlOnly ? 'Safe' : simulation.timeToPoolExhaustionSec + 's'}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Убыток бизнеса</div>
      <div class="stat-val ${totalLossRub > 0 ? 'red' : ''}">${analysis.isDmlOnly ? '0 ₽' : '~' + totalLossRub.toLocaleString('ru-RU') + ' ₽'}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Нарушений в коде</div>
      <div class="stat-val ${analysis.violationsCount > 0 ? 'red' : ''}">${analysis.violationsCount}</div>
    </div>
  </div>

  <h2>1. Анализ блокировок и найденные антипаттерны (${analysis.violationsCount})</h2>
  ${violationsHtml || '<p style="color:#16A34A;">Антипаттернов блокировок не обнаружено.</p>'}

  ${splitPlan.phases && splitPlan.phases.length > 0 ? `
    <h2 style="page-break-before:always;">2. Рекомендуемый безопасный план релиза (4 этапа Auto-Splitter)</h2>
    <p style="font-size:12px; color:#475569; margin-bottom:12px;">Для предотвращения простоя опасная миграция автоматически разделена на изолированные неблокирующие шаги:</p>
    ${phasesHtml}
  ` : ''}

  <h2>3. Заключение и экспертные рекомендации</h2>
  <ol style="padding-left:18px; font-size:12px; color:#334155; line-height:1.6;">
    <li><b>Интеграция в CI/CD:</b> Рекомендуется подключить автоматический линтер <code>uses: Mars444456/lockguard@v1</code> в GitHub Actions для автоматической блокировки PR с опасным DDL.</li>
    <li><b>Обязательный таймаут:</b> Каждая транзакция DDL должна начинаться с директивы <code>SET lock_timeout = '3s';</code> во избежание Head-of-Line блокировок.</li>
    <li><b>Фоновое построение индексов:</b> Все индексы должны создаваться с модификатором <code>CONCURRENTLY</code> вне транзакционных блоков.</li>
  </ol>

  <div class="footer">
    <div>Официальный аудит LockGuard Engine • Конфиденциально для руководства команды</div>
    <div>Заказать аудит всей инфраструктуры баз данных: <b>@marswwu</b></div>
  </div>

  <script>
    window.onload = function() {
      // Auto open print dialog after short render delay
      setTimeout(function() {
        window.print();
      }, 300);
    };
  </script>
</body>
</html>`;

    const printWin = window.open('', '_blank');
    if (printWin) {
      printWin.document.open();
      printWin.document.write(reportHtml);
      printWin.document.close();
    } else {
      alert('Пожалуйста, разрешите открытие всплывающего окна в браузере, чтобы сформировать PDF-отчет.');
    }
  }
}

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new LockGuardWebPlayground();
});
