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
    this.btnAnalyze = document.getElementById('btn-analyze');
    this.btnSplit = document.getElementById('btn-split');
    this.btnClear = document.getElementById('btn-clear-sql');
    
    this.sliderRows = document.getElementById('slider-rows');
    this.valRows = document.getElementById('val-rows');
    this.sliderRps = document.getElementById('slider-rps');
    this.valRps = document.getElementById('val-rps');

    this.verdictBadge = document.getElementById('verdict-badge');
    this.emptyState = document.getElementById('empty-state');
    this.analysisDetails = document.getElementById('analysis-details');
    this.splitterPanel = document.getElementById('splitter-panel');

    this.resMaxLock = document.getElementById('res-max-lock');
    this.resLockSub = document.getElementById('res-lock-sub');
    this.resViolationsCount = document.getElementById('res-violations-count');
    this.resViolationsSub = document.getElementById('res-violations-sub');
    this.resDowntime = document.getElementById('res-downtime');
    this.resDowntimeSub = document.getElementById('res-downtime-sub');
    this.resBlockedQueries = document.getElementById('res-blocked-queries');

    this.violationsList = document.getElementById('violations-list');
    this.splitterPhases = document.getElementById('splitter-phases');

    this.currentOrm = 'sql';
    this.lastAnalysis = null;

    this.initEventListeners();
    this.loadPreset('catastrophic');
  }

  initEventListeners() {
    this.presetSelect.addEventListener('change', (e) => this.loadPreset(e.target.value));
    this.btnAnalyze.addEventListener('click', () => this.runAnalysis());
    this.btnSplit.addEventListener('click', () => this.runSplitter());
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

    // 1. Analyze AST
    const analysis = window.LockGuard.analyze(sql);
    this.lastAnalysis = analysis;

    // 2. Simulate Latency & Blocked Queries
    const simulation = window.LockGuard.simulate(analysis, { simulatedRows: rows, concurrentRps: rps });

    // 3. Render Results
    this.emptyState.classList.add('hidden');
    this.analysisDetails.classList.remove('hidden');

    this.renderVerdict(analysis);
    this.renderMetrics(analysis, simulation, rows);
    this.renderLockMatrix(analysis.highestLockLevel);
    this.renderViolations(analysis.violations);
  }

  renderVerdict(analysis) {
    if (analysis.passed) {
      this.verdictBadge.className = 'verdict-pill passed';
      this.verdictBadge.innerHTML = '✔ 100% ZERO-DOWNTIME SAFE';
    } else {
      this.verdictBadge.className = 'verdict-pill failed';
      this.verdictBadge.innerHTML = `✖ CI RELEASE BLOCKED (${analysis.criticalCount} Critical)`;
    }
  }

  renderMetrics(analysis, simulation, rows) {
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
          <span class="badge-sev ${v.severity.toLowerCase()}">${v.severity} • ${v.lockLevel}</span>
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

    plan.phases.forEach(p => {
      const card = document.createElement('div');
      card.className = 'phase-card';
      card.innerHTML = `
        <div class="phase-title">📦 [PHASE ${p.phase}]: ${p.title}</div>
        <div class="phase-desc">${p.description}</div>
        <pre class="phase-code">${p.code}</pre>
      `;
      this.splitterPhases.appendChild(card);
    });
  }
}

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new LockGuardWebPlayground();
});
