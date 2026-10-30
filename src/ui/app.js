/**
 * LockGuard Web Dashboard Application Client
 */

const PRESETS = {
  catastrophic: `-- Catastrophic Real-World E-Commerce PR Migration
-- Warning: Missing SET lock_timeout!
BEGIN;

-- 1. Blocking Index Creation (takes SHARE lock on transactions)
CREATE INDEX idx_transactions_created_at ON transactions (created_at);

-- 2. Heavy ADD COLUMN with volatile DEFAULT (full table rewrite!)
ALTER TABLE accounts ADD COLUMN token UUID DEFAULT gen_random_uuid() NOT NULL;

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

  add_column: `-- Unsafe ADD COLUMN with volatile default
SET lock_timeout = '3s';

ALTER TABLE orders ADD COLUMN token UUID DEFAULT gen_random_uuid() NOT NULL;
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

ALTER TABLE subscriptions ADD CONSTRAINT uq_subscriptions_user_plan UNIQUE (user_id, plan_id);`,

  missing_timeout: `-- Migration missing SET lock_timeout
-- If an ALTER TABLE is delayed, this blocks all incoming queries behind it!
ALTER TABLE users ADD COLUMN is_verified BOOLEAN;`,

  drop_column: `-- Direct DROP COLUMN on production table (LG-006)
-- ACCESS EXCLUSIVE lock crashes active ORM models and replica queries!
SET lock_timeout = '3s';

ALTER TABLE users DROP COLUMN legacy_pin;`,

  unindexed_fk: `-- Unindexed Foreign Key causing cascading table locks (LG-011)
-- Any UPDATE or DELETE on parent 'accounts' will lock and sequentially scan 'transactions'!
SET lock_timeout = '3s';

ALTER TABLE transactions 
  ADD CONSTRAINT fk_tx_account 
  FOREIGN KEY (account_id) 
  REFERENCES accounts(id) 
  NOT VALID;`,

  truncate_matview: `-- Fatal TRUNCATE TABLE & Unconcurrent Materialized View Refresh (LG-012)
-- Takes ACCESS EXCLUSIVE lock, completely freezing all reading queries!
SET lock_timeout = '3s';

TRUNCATE TABLE audit_logs;
REFRESH MATERIALIZED VIEW mv_user_summaries;`,

  safe_migration: `-- 100% Safe Zero-Downtime PostgreSQL Migration Pattern
-- 1. Mandatory Safeguard: fail fast instead of queueing locks
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- 2. Add column nullable without default (Instant catalog change)
ALTER TABLE accounts ADD COLUMN updated_at TIMESTAMP;

-- 3. Set default for future rows only
ALTER TABLE accounts ALTER COLUMN updated_at SET DEFAULT now();

-- 4. Non-blocking Foreign Key with NOT VALID
ALTER TABLE transactions 
  ADD CONSTRAINT fk_tx_account 
  FOREIGN KEY (account_id) 
  REFERENCES accounts(id) 
  NOT VALID;

-- 5. Validate Foreign Key separately (weak lock, reads & writes proceed!)
ALTER TABLE transactions VALIDATE CONSTRAINT fk_tx_account;

-- 6. Concurrent Unique Index
CREATE UNIQUE INDEX CONCURRENTLY idx_accounts_iban_unique ON accounts (iban);

-- 7. Attach constraint to existing index (instant catalog change)
ALTER TABLE accounts ADD CONSTRAINT uq_account_iban UNIQUE USING INDEX idx_accounts_iban_unique;

-- 8. Concurrent Index
CREATE INDEX CONCURRENTLY idx_transactions_created_at ON transactions (created_at);`
};

class LockGuardApp {
  constructor() {
    this.currentTab = 'playground';
    this.latestMarkdownReport = '';
    this.organization = null;
    this.init();
  }

  async init() {
    this.bindEvents();
    this.loadPreset('catastrophic');
    await this.fetchOrganization();
    await this.fetchRules();
    await this.fetchRuns();
    await this.fetchKeys();
  }

  bindEvents() {
    // Navigation Tabs
    document.querySelectorAll('.nav-tab').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const tab = tabBtn.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Preset selector
    const presetSelect = document.getElementById('preset-select');
    presetSelect.addEventListener('change', (e) => {
      this.loadPreset(e.target.value);
    });

    // Analyze button
    document.getElementById('btn-analyze').addEventListener('click', () => {
      this.analyzeCurrentSql();
    });

    // Auto-Split button
    const btnSplit = document.getElementById('btn-split');
    if (btnSplit) {
      btnSplit.addEventListener('click', () => {
        this.splitCurrentSql();
      });
    }

    // Clear SQL
    document.getElementById('btn-clear-sql').addEventListener('click', () => {
      document.getElementById('sql-input').value = '';
    });

    // Copy PR Markdown
    document.getElementById('btn-copy-pr-md').addEventListener('click', () => {
      if (this.latestMarkdownReport) {
        navigator.clipboard.writeText(this.latestMarkdownReport);
        this.showToast('Copied GitHub PR Comment Markdown to clipboard!');
      }
    });

    // Simulate Webhook Check
    document.getElementById('btn-simulate-webhook').addEventListener('click', () => {
      this.simulatePrWebhook();
    });

    // Create Key
    document.getElementById('btn-create-key').addEventListener('click', () => {
      this.promptCreateKey();
    });
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
  }

  loadPreset(key) {
    const sql = PRESETS[key] || '';
    document.getElementById('sql-input').value = sql;
    document.getElementById('current-filename').textContent = `${key}_migration.sql`;
    this.analyzeCurrentSql();
  }

  async analyzeCurrentSql() {
    const sql = document.getElementById('sql-input').value.trim();
    if (!sql) {
      this.showToast('Please enter SQL statements to analyze.');
      return;
    }

    const withContext = document.getElementById('chk-context')?.checked ?? true;
    const btn = document.getElementById('btn-analyze');
    btn.disabled = true;
    btn.textContent = 'Analyzing AST...';

    try {
      const res = await fetch('/api/v1/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql,
          filename: document.getElementById('current-filename').textContent,
          withContext
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze SQL');
      }

      this.renderAnalysis(data.data);
    } catch (err) {
      this.showToast('Analysis error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Analyze Migration';
    }
  }

  async splitCurrentSql() {
    const sql = document.getElementById('sql-input').value.trim();
    if (!sql) {
      this.showToast('Please enter SQL statements to split.');
      return;
    }

    const btn = document.getElementById('btn-split');
    btn.disabled = true;
    btn.textContent = 'Splitting...';

    try {
      const res = await fetch('/api/v1/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, orm: 'sql' })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to split migration');

      if (data.plan.isSafe) {
        this.showToast('Migration is already safe! No splitting required.');
      } else {
        const violationsList = document.getElementById('violations-list');
        violationsList.innerHTML = `
          <div style="background: rgba(6, 182, 212, 0.1); border: 1px solid var(--accent-cyan); border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
            <h4 style="color: var(--accent-cyan); margin-bottom: 0.5rem;">🔀 Auto-Splitter: Decomposed into ${data.plan.totalPhases} Zero-Downtime Releases</h4>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Apply these releases sequentially across deployments to eliminate production locking.</p>
          </div>
        `;

        data.plan.phases.forEach(p => {
          const item = document.createElement('div');
          item.className = 'violation-card';
          item.style.borderLeftColor = 'var(--accent-cyan)';
          item.innerHTML = `
            <div class="violation-header">
              <span class="violation-title">📦 Phase ${p.phaseNumber}: ${p.title}</span>
            </div>
            <div class="violation-desc" style="color: var(--text-muted);">${p.description}</div>
            <div class="fix-box">
              <div class="fix-header">
                <span>SQL Release Script</span>
                <button class="btn-secondary btn-xs btn-copy-snippet" data-fix="${encodeURIComponent(p.sql)}">Copy Script</button>
              </div>
              <div class="fix-code">${this.escapeHtml(p.sql)}</div>
            </div>
          `;
          violationsList.appendChild(item);
        });

        violationsList.querySelectorAll('.btn-copy-snippet').forEach(b => {
          b.addEventListener('click', (e) => {
            const raw = decodeURIComponent(e.target.dataset.fix);
            navigator.clipboard.writeText(raw);
            this.showToast('Copied phase script to clipboard!');
          });
        });

        this.showToast(`Auto-Split into ${data.plan.totalPhases} zero-downtime releases!`);
      }
    } catch (err) {
      this.showToast('Split error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔀 Auto-Split';
    }
  }

  renderAnalysis(result) {
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('analysis-details').classList.remove('hidden');

    const verdictBadge = document.getElementById('verdict-badge');
    if (result.passed) {
      verdictBadge.className = 'verdict-pill passed';
      verdictBadge.textContent = '✔ Zero Downtime Safe';
    } else {
      verdictBadge.className = 'verdict-pill blocked';
      verdictBadge.textContent = '🛑 Blocked (Dangerous Locks)';
    }

    // Metric tiles
    document.getElementById('res-max-lock').textContent = result.highestLockLevel;
    document.getElementById('res-lock-sub').textContent = result.lockImpact ? result.lockImpact.impact : 'Safe for production';
    document.getElementById('res-violations-count').textContent = result.violationsCount;
    document.getElementById('res-violations-sub').textContent = `${result.criticalCount} Critical, ${result.highCount} High`;
    document.getElementById('res-tables-count').textContent = result.affectedTables.length;
    document.getElementById('res-tables-list').textContent = result.affectedTables.join(', ') || 'None';

    // Violations List
    const violationsList = document.getElementById('violations-list');
    violationsList.innerHTML = '';

    if (result.violations.length === 0) {
      violationsList.innerHTML = `
        <div style="padding: 1.5rem; text-align: center; color: var(--accent-emerald); background: rgba(16, 185, 129, 0.1); border-radius: 8px;">
          ✔ <b>No dangerous locks detected!</b> This migration can be safely applied under zero-downtime traffic.
        </div>
      `;
    } else {
      result.violations.forEach((v, i) => {
        const item = document.createElement('div');
        item.className = `violation-card ${v.severity.toLowerCase()}`;
        item.innerHTML = `
          <div class="violation-header">
            <span class="violation-title">${i + 1}. ${v.ruleName}</span>
            <span class="violation-tag ${v.severity.toLowerCase()}">${v.severity}</span>
          </div>
          <div class="violation-meta">
            Rule: <b>${v.ruleId}</b> | Table: <b>${v.table}</b> | Lock: <b>${v.lockLevel}</b> | Line: <b>L${v.line}</b>
          </div>
          ${v.estimatedDowntimeFormatted ? `
            <div style="font-size:0.75rem; color:var(--accent-red); margin-bottom:0.4rem; font-weight:700;">
              ⏱️ Расчетное время лока: ~${v.estimatedDowntimeFormatted} (${v.downtimeRiskLevel})
            </div>
          ` : ''}
          <div class="violation-desc">${v.contextualMessage || v.message}</div>
          ${v.safeFix ? `
            <div class="fix-box">
              <div class="fix-header">
                <span>💡 Safe Multi-Step Alternative</span>
                <button class="btn-secondary btn-xs btn-copy-snippet" data-fix="${encodeURIComponent(v.safeFix)}">Copy Fix</button>
              </div>
              <div class="fix-code">${this.escapeHtml(v.safeFix)}</div>
            </div>
          ` : ''}
        `;
        violationsList.appendChild(item);
      });

      // Bind fix copy buttons
      violationsList.querySelectorAll('.btn-copy-snippet').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const raw = decodeURIComponent(e.target.dataset.fix);
          navigator.clipboard.writeText(raw);
          this.showToast('Safe SQL snippet copied to clipboard!');
        });
      });
    }

    // Markdown preview
    this.latestMarkdownReport = result.markdownReport;
    document.getElementById('pr-markdown-box').textContent = result.markdownReport;
  }

  async fetchOrganization() {
    try {
      const res = await fetch('/api/v1/organization');
      const data = await res.json();
      if (data.organization) {
        this.organization = data.organization;
        document.getElementById('org-name').textContent = this.organization.name;
        const planPill = document.getElementById('org-plan-badge');
        planPill.className = `plan-pill ${this.organization.plan}`;
        planPill.textContent = `${this.organization.plan.toUpperCase()} (${this.organization.plan === 'team' ? '$39/mo' : (this.organization.plan === 'business' ? '$99/mo' : '$0')})`;
        this.updatePlanCards(this.organization.plan);
      }
    } catch (err) {
      console.warn('Failed to fetch org:', err);
    }
  }

  async fetchRules() {
    try {
      const res = await fetch('/api/v1/rules');
      const data = await res.json();
      const grid = document.getElementById('rules-grid');
      grid.innerHTML = '';

      data.rules.forEach(r => {
        const card = document.createElement('div');
        card.className = 'rule-card';
        card.innerHTML = `
          <div>
            <div class="rule-top">
              <span class="rule-id">${r.id}</span>
              <span class="violation-tag ${r.severity.toLowerCase()}">${r.severity}</span>
            </div>
            <div class="rule-name">${r.name}</div>
            <div class="rule-desc">${r.description}</div>
          </div>
          <div class="rule-footer">
            <span>Lock Level: <b style="color: var(--accent-red);">${r.lockLevel}</b></span>
            <span>Target: PostgreSQL</span>
          </div>
        `;
        grid.appendChild(card);
      });
    } catch (err) {
      console.warn('Failed to fetch rules:', err);
    }
  }

  async fetchRuns() {
    try {
      const res = await fetch('/api/v1/runs');
      const data = await res.json();
      const tbody = document.getElementById('runs-tbody');
      tbody.innerHTML = '';

      data.runs.forEach(run => {
        const tr = document.createElement('tr');
        const isPassed = run.status === 'PASSED';
        tr.innerHTML = `
          <td>
            <span class="verdict-pill ${isPassed ? 'passed' : 'blocked'}">
              ${isPassed ? '✔ PASSED' : '🛑 BLOCKED'}
            </span>
          </td>
          <td>
            <b>${run.repo}</b><br>
            <span style="font-size: 0.75rem; color: var(--text-muted);">PR #${run.prNumber} by @${run.author || 'dev'}</span>
          </td>
          <td>
            <code>${run.branch}</code><br>
            <span style="font-size: 0.72rem; color: var(--text-dim);">${run.commit}</span>
          </td>
          <td>
            <span style="font-family: var(--font-mono); font-size: 0.8rem; color: ${run.highestLockLevel === 'ACCESS EXCLUSIVE' ? 'var(--accent-red)' : 'var(--text-main)'}">
              ${run.highestLockLevel}
            </span>
          </td>
          <td>
            <b>${run.violationsCount}</b>
            <span style="font-size: 0.75rem; color: var(--text-dim);">(${run.criticalCount || 0} crit)</span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.75rem;">
            ${new Date(run.timestamp).toLocaleTimeString()}
          </td>
          <td>
            <button class="btn-secondary btn-xs" onclick="app.viewRunDetails('${run.id}')">View Details</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.warn('Failed to fetch runs:', err);
    }
  }

  async fetchKeys() {
    try {
      const res = await fetch('/api/v1/keys');
      const data = await res.json();
      const tbody = document.getElementById('keys-tbody');
      tbody.innerHTML = '';

      data.keys.forEach(k => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${k.name}</b></td>
          <td>
            <code>${k.key.substring(0, 10)}••••••••••••••••</code>
            <button class="btn-secondary btn-xs" style="margin-left: 0.5rem;" onclick="app.copyKey('${k.key}')">Copy</button>
          </td>
          <td style="font-size: 0.75rem; color: var(--text-muted);">${new Date(k.createdAt).toLocaleDateString()}</td>
          <td style="font-size: 0.75rem; color: var(--text-muted);">${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}</td>
          <td>
            <span class="plan-pill ${k.status === 'active' ? 'team' : 'free'}">${k.status.toUpperCase()}</span>
          </td>
          <td>
            ${k.status === 'active' ? `
              <button class="btn-secondary btn-xs" style="color: var(--accent-red);" onclick="app.revokeKey('${k.id}')">Revoke</button>
            ` : '<span style="color: var(--text-dim); font-size: 0.75rem;">Revoked</span>'}
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.warn('Failed to fetch keys:', err);
    }
  }

  async simulatePrWebhook() {
    try {
      const prNumber = Math.floor(Math.random() * 800) + 100;
      const res = await fetch('/api/v1/github/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prNumber,
          branch: 'feat/dangerous-db-changes-' + prNumber
        })
      });

      const data = await res.json();
      this.showToast(`Simulated PR #${prNumber} webhook audit completed! Status: ${data.action.toUpperCase()}`);
      await this.fetchRuns();
    } catch (err) {
      this.showToast('Webhook simulation error: ' + err.message);
    }
  }

  async promptCreateKey() {
    const name = prompt('Enter a name for this API Key (e.g. "GitHub Actions CI"):');
    if (!name) return;

    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      this.showToast(`Key "${name}" created!`);
      await this.fetchKeys();
    } catch (err) {
      this.showToast('Error creating key: ' + err.message);
    }
  }

  async revokeKey(id) {
    if (!confirm('Are you sure you want to revoke this API key? CI/CD pipelines using it will fail.')) return;
    try {
      await fetch(`/api/v1/keys/${id}`, { method: 'DELETE' });
      this.showToast('API Key revoked.');
      await this.fetchKeys();
    } catch (err) {
      this.showToast('Error revoking key: ' + err.message);
    }
  }

  copyKey(key) {
    navigator.clipboard.writeText(key);
    this.showToast('Copied full API Key to clipboard!');
  }

  viewRunDetails(runId) {
    this.switchTab('playground');
    this.showToast(`Inspecting details for ${runId} in Playground.`);
  }

  async selectPlan(plan) {
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan })
      });

      const data = await res.json();
      this.showToast(data.message || `Switched plan to ${plan}!`);
      await this.fetchOrganization();
    } catch (err) {
      this.showToast('Billing error: ' + err.message);
    }
  }

  updatePlanCards(currentPlan) {
    const plans = ['free', 'team', 'business'];
    plans.forEach(p => {
      const card = document.getElementById(`card-plan-${p}`);
      if (!card) return;
      const btn = card.querySelector('.btn-plan');
      if (p === currentPlan) {
        btn.textContent = 'Current Plan (Active)';
        btn.className = 'btn-plan btn-secondary';
        btn.disabled = true;
      } else {
        btn.disabled = false;
        btn.textContent = p === 'team' ? 'Upgrade to Pro Team (1 500 ₽)' : (p === 'business' ? 'Заказать аудит миграций (30 000 ₽)' : 'Downgrade to Free');
        btn.className = p === 'team' ? 'btn-plan btn-primary' : 'btn-plan btn-secondary';
      }
    });
  }

  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

const app = new LockGuardApp();
window.app = app;
