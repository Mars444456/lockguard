/**
 * LockGuard Web Dashboard Application Client
 */

let adminToken = '';
function setAdminToken() {
  const value = window.prompt('Administrator token (leave empty to sign out):');
  if (value === null) return;
  adminToken = value.trim();
  app.fetchOrganization();
  app.fetchKeys();
  app.fetchRuns();
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return response;
}

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
    const paymentReturn = new URLSearchParams(window.location.search).get('payment');
    if (paymentReturn) {
      this.switchTab('billing');
      this.showToast(paymentReturn === 'cancelled' ? 'Оплата прервана. Заказ не активирован.' : 'Возврат с оплаты. Статус заказа проверяется по уведомлению Robokassa.');
    }
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
      const res = await apiFetch('/api/v1/analyze', {
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
      const res = await apiFetch('/api/v1/split', {
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
              <span class="violation-title">📦 Phase ${p.phaseNumber}: ${this.escapeHtml(p.title)}</span>
            </div>
            <div class="violation-desc" style="color: var(--text-muted);">${this.escapeHtml(p.description)}</div>
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
      verdictBadge.textContent = '✔ No rule violations detected';
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
          ✔ <b>No dangerous locks detected!</b> Review schema, transaction boundaries and workload before deployment.
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
            Rule: <b>${v.ruleId}</b> | Table: <b>${this.escapeHtml(v.table)}</b> | Lock: <b>${v.lockLevel}</b> | Line: <b>L${v.line}</b>
          </div>
          ${v.estimatedDowntimeFormatted ? `
            <div style="font-size:0.75rem; color:var(--accent-red); margin-bottom:0.4rem; font-weight:700;">
              ⏱️ Расчетное время лока: ~${v.estimatedDowntimeFormatted} (${v.downtimeRiskLevel})
            </div>
          ` : ''}
          <div class="violation-desc">${this.escapeHtml(v.contextualMessage || v.message)}</div>
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
      const res = await apiFetch('/api/v1/organization');
      const data = await res.json();
      if (data.organization) {
        this.organization = data.organization;
        document.getElementById('org-name').textContent = this.organization.name;
        const planPill = document.getElementById('org-plan-badge');
        planPill.className = `plan-pill ${this.organization.plan}`;
        planPill.textContent = this.organization.plan === 'team'
          ? `PRO${this.organization.accessUntil ? ' до ' + new Date(this.organization.accessUntil).toLocaleDateString('ru-RU') : ''}` : this.organization.plan.toUpperCase();
        this.updatePlanCards(this.organization.plan);
      }
    } catch (err) {
      console.warn('Failed to fetch org:', err);
    }
  }

  async fetchRules() {
    try {
      const res = await apiFetch('/api/v1/rules');
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
      const res = await apiFetch('/api/v1/runs');
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
            <b>${this.escapeHtml(run.repo)}</b><br>
            <span style="font-size: 0.75rem; color: var(--text-muted);">PR #${this.escapeHtml(run.prNumber)} by @${this.escapeHtml(run.author || 'dev')}</span>
          </td>
          <td>
            <code>${this.escapeHtml(run.branch)}</code><br>
            <span style="font-size: 0.72rem; color: var(--text-dim);">${this.escapeHtml(run.commit)}</span>
          </td>
          <td>
            <span style="font-family: var(--font-mono); font-size: 0.8rem; color: ${run.highestLockLevel === 'ACCESS EXCLUSIVE' ? 'var(--accent-red)' : 'var(--text-main)'}">
              ${this.escapeHtml(run.highestLockLevel)}
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
      const res = await apiFetch('/api/v1/keys');
      const data = await res.json();
      const tbody = document.getElementById('keys-tbody');
      tbody.innerHTML = '';

      data.keys.forEach(k => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${this.escapeHtml(k.name)}</b></td>
          <td>
            <code>${k.key.substring(0, 10)}••••••••••••••••</code>
            <small>Secret shown only when created</small>
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
      const res = await apiFetch('/api/v1/github/webhook', {
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
      const res = await apiFetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      this.showToast(`Key "${name}" created!`);
      window.prompt('Copy this API key now. It will not be shown again:', data.key.key);
      await this.fetchKeys();
    } catch (err) {
      this.showToast('Error creating key: ' + err.message);
    }
  }

  async revokeKey(id) {
    if (!confirm('Are you sure you want to revoke this API key? CI/CD pipelines using it will fail.')) return;
    try {
      await apiFetch(`/api/v1/keys/${id}`, { method: 'DELETE' });
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
    if (plan === 'free') { this.showToast('Бесплатный анализ доступен без оплаты.'); return; }
    if (this.paymentRequestInFlight) return;
    const email = window.prompt('Email покупателя для заказа и чека:');
    if (email === null) return;
    this.paymentRequestInFlight = true;
    try {
      const res = await apiFetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, email: email.trim(), requestId: crypto.randomUUID() })
      });

      const data = await res.json();
      document.getElementById('billing-payment-link').value = data.url;
      document.getElementById('billing-payment-section').hidden = false;
      this.showToast(data.testMode ? 'Создан тестовый заказ. Рабочий доступ не изменится.' : 'Заказ создан. Оплатите на странице Robokassa, затем обновите статус.');
      const form = document.createElement('form');
      form.method = 'POST'; form.action = data.paymentForm.action; form.target = '_blank';
      for (const [name, value] of Object.entries(data.paymentForm.fields)) {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input);
      }
      document.body.appendChild(form); form.submit(); form.remove();
      await this.fetchPaymentOrders();
    } catch (err) {
      this.showToast('Billing error: ' + err.message);
    } finally { this.paymentRequestInFlight = false; }
  }

  async fetchPaymentOrders() {
    try {
      const res = await apiFetch('/api/v1/billing/orders');
      const { orders } = await res.json();
      const list = document.getElementById('billing-orders');
      list.replaceChildren();
      const labels = { pending: 'Ожидает оплаты', paid: 'Оплачен', test_paid: 'Тестовая оплата — рабочий доступ не изменён' };
      for (const order of [...orders].reverse().slice(0, 20)) {
        const row = document.createElement('p');
        row.textContent = `№${order.id}: ${order.title} — ${order.amount} ₽ — ${labels[order.status] || order.status}${order.fulfillmentStatus === 'awaiting_audit' ? '. Аудит ожидает выполнения.' : ''}`;
        list.appendChild(row);
      }
      await this.fetchOrganization();
    } catch (error) { this.showToast(error.message); }
  }

  updatePlanCards(currentPlan) {
    const plans = ['free', 'team', 'business'];
    plans.forEach(p => {
      const card = document.getElementById(`card-plan-${p}`);
      if (!card) return;
      const btn = card.querySelector('.btn-plan');
      if (p === 'free') {
        btn.textContent = 'Бесплатный анализ'; btn.disabled = true;
      } else if (p === currentPlan && p !== 'team') {
        btn.textContent = 'Current Plan (Active)';
        btn.className = 'btn-plan btn-secondary';
        btn.disabled = true;
      } else {
        btn.disabled = false;
        btn.textContent = p === 'team' ? (currentPlan === 'team' ? 'Продлить на 30 дней — 1 500 ₽' : 'Оплатить 30 дней — 1 500 ₽') : 'Оплатить аудит — 30 000 ₽';
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
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

const app = new LockGuardApp();
window.app = app;

// ==============================================================================
// Terminal Snippet Copy
// ==============================================================================
window.copyHeroTerminalCommand = function() {
  const cmd = 'npx lockguard check ./migrations --strict';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(cmd).then(() => {
      const label = document.getElementById('copy-terminal-label');
      if (label) {
        const orig = label.textContent;
        label.textContent = '✔ Скопировано!';
        setTimeout(() => { label.textContent = orig; }, 2500);
      }
    }).catch(() => fallbackCopy(cmd));
  } else {
    fallbackCopy(cmd);
  }
};

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  const label = document.getElementById('copy-terminal-label');
  if (label) {
    const orig = label.textContent;
    label.textContent = '✔ Скопировано!';
    setTimeout(() => { label.textContent = orig; }, 2500);
  }
}

// ==============================================================================
// Interactive PostgreSQL Lock Compatibility Matrix Explorer
// ==============================================================================
const PG_LOCK_MODES = [
  'ACCESS SHARE',
  'ROW SHARE',
  'ROW EXCLUSIVE',
  'SHARE UPDATE EXCLUSIVE',
  'SHARE',
  'SHARE ROW EXCLUSIVE',
  'EXCLUSIVE',
  'ACCESS EXCLUSIVE'
];

const PG_LOCK_CONFLICTS = {
  'ACCESS SHARE': ['ACCESS EXCLUSIVE'],
  'ROW SHARE': ['EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'ROW EXCLUSIVE': ['SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'SHARE UPDATE EXCLUSIVE': ['SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'SHARE': ['ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'SHARE ROW EXCLUSIVE': ['ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'EXCLUSIVE': ['ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'ACCESS EXCLUSIVE': [
    'ACCESS SHARE', 'ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE',
    'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'
  ]
};

const PG_LOCK_DETAILS = {
  'ACCESS EXCLUSIVE': {
    title: '🚨 ACCESS EXCLUSIVE: Fatal Table Lock (Full Outage Risk)',
    desc: 'Blocks <b>all table operations</b>: reads (<code>SELECT</code>), writes (<code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>), indexes, and schema modifications. If a slow query is running, DDL queues behind it, and subsequent <code>SELECT</code> queries pile up (Head-of-Line Blocking), crashing connection pools and triggering <b>HTTP 504 Gateway Timeouts</b>.',
    blocked: ['SELECT (ACCESS SHARE)', 'INSERT / UPDATE / DELETE (ROW EXCLUSIVE)', 'CREATE INDEX (SHARE)', 'VACUUM / ANALYZE'],
    safe: []
  },
  'SHARE': {
    title: '⛔ SHARE: Write Freeze Lock (INSERT/UPDATE Blocked)',
    desc: 'Allows concurrent reads (<code>SELECT</code>), but <b>completely freezes all write operations</b>: <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>! All active user mutations will block until the index generation finishes.',
    blocked: ['INSERT / UPDATE / DELETE (ROW EXCLUSIVE)', 'CREATE INDEX (SHARE)', 'Any ALTER TABLE (ACCESS EXCLUSIVE)'],
    safe: ['Parallel SELECT (ACCESS SHARE)', 'SELECT FOR UPDATE (ROW SHARE)']
  },
  'SHARE UPDATE EXCLUSIVE': {
    title: '✅ SHARE UPDATE EXCLUSIVE: Safe Non-Blocking Mode (Zero-Downtime)',
    desc: '<b>The gold standard for zero-downtime PostgreSQL operations!</b> Conflicts ONLY with other concurrent schema modifications or autovacuum, but is <b>100% compatible with user reads (<code>SELECT</code>) and writes (<code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>)</b>! Production traffic operates at full speed.',
    blocked: ['Parallel VACUUM / ANALYZE', 'Another CREATE INDEX CONCURRENTLY', 'ALTER TABLE (ACCESS EXCLUSIVE)'],
    safe: ['User SELECT (ACCESS SHARE)', 'User INSERT / UPDATE / DELETE (ROW EXCLUSIVE)', 'SELECT FOR UPDATE']
  },
  'ROW EXCLUSIVE': {
    title: '⚡ ROW EXCLUSIVE: Normal High-Volume Write Traffic',
    desc: 'Acquired by standard row mutation operations (<code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>). Compatible with other writes to different rows, but immediately blocked by dangerous DDL.',
    blocked: ['CREATE INDEX (SHARE)', 'ALTER TABLE (ACCESS EXCLUSIVE)', 'TRUNCATE'],
    safe: ['Concurrent SELECT (ACCESS SHARE)', 'Concurrent INSERT/UPDATE (ROW EXCLUSIVE)', 'CREATE INDEX CONCURRENTLY']
  },
  'ACCESS SHARE': {
    title: '📖 ACCESS SHARE: Normal High-Volume Read Traffic',
    desc: 'Acquired by standard <code>SELECT</code> queries. Compatible with everything except the heaviest lock — <code>ACCESS EXCLUSIVE</code>. This is why a monolithic ALTER TABLE freezes an entire web application.',
    blocked: ['ALTER TABLE (ACCESS EXCLUSIVE)', 'DROP TABLE', 'TRUNCATE'],
    safe: ['Concurrent SELECT (ACCESS SHARE)', 'INSERT / UPDATE / DELETE (ROW EXCLUSIVE)', 'CREATE INDEX CONCURRENTLY']
  },
  'EXCLUSIVE': {
    title: '🔒 EXCLUSIVE: Exclusive Write and Concurrent Index Lock',
    desc: 'Blocks all writes and concurrent index operations, while permitting non-blocking <code>SELECT</code> queries.',
    blocked: ['INSERT / UPDATE / DELETE', 'SELECT FOR UPDATE', 'Parallel CREATE INDEX'],
    safe: ['Simple SELECT (ACCESS SHARE)']
  }
};

function initLockMatrixExplorer() {
  const tbody = document.getElementById('pg-lock-matrix-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  PG_LOCK_MODES.forEach(reqLock => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-row-lock', reqLock);

    const th = document.createElement('th');
    th.style.textAlign = 'left';
    th.style.paddingLeft = '0.75rem';
    th.textContent = reqLock;
    tr.appendChild(th);

    PG_LOCK_MODES.forEach(existLock => {
      const td = document.createElement('td');
      const isConflict = PG_LOCK_CONFLICTS[reqLock] && PG_LOCK_CONFLICTS[reqLock].includes(existLock);
      td.setAttribute('data-col-lock', existLock);
      td.className = isConflict ? 'cell-conflict' : 'cell-safe';
      td.textContent = isConflict ? '⛔ BLOCK' : '✔ OK';
      td.title = `${reqLock} vs ${existLock}: ${isConflict ? 'CONFLICT' : 'COMPATIBLE'}`;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  const buttons = document.querySelectorAll('#matrix-quick-filters .matrix-filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const lock = btn.getAttribute('data-lock');
      selectLockMode(lock);
    });
  });

  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const lock = tr.getAttribute('data-row-lock');
    if (lock) {
      buttons.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-lock') === lock);
      });
      selectLockMode(lock);
    }
  });

  selectLockMode('ACCESS EXCLUSIVE');
}

function selectLockMode(lockMode) {
  const tbody = document.getElementById('pg-lock-matrix-body');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  rows.forEach(tr => {
    const rLock = tr.getAttribute('data-row-lock');
    const isTarget = rLock === lockMode;
    tr.classList.toggle('highlight-row', isTarget);
    const cells = tr.querySelectorAll('td');
    cells.forEach(td => {
      td.classList.toggle('highlight-active', isTarget);
    });
  });

  const details = PG_LOCK_DETAILS[lockMode] || {
    title: `ℹ️ ${lockMode}: Lock Mode`,
    desc: `Blocks operations that conflict with this lock level per PostgreSQL specification.`,
    blocked: PG_LOCK_CONFLICTS[lockMode] || [],
    safe: []
  };

  const titleEl = document.getElementById('explainer-title');
  const descEl = document.getElementById('explainer-desc');
  const tagsEl = document.getElementById('explainer-tags');

  if (titleEl) titleEl.innerHTML = `<span>${details.title}</span>`;
  if (descEl) descEl.innerHTML = details.desc;
  if (tagsEl) {
    let html = '';
    (details.blocked || []).forEach(item => {
      html += `<span class="explainer-tag tag-blocked">⛔ Blocks: ${item}</span>`;
    });
    (details.safe || []).forEach(item => {
      html += `<span class="explainer-tag tag-safe">✔ Compatible: ${item}</span>`;
    });
    tagsEl.innerHTML = html;
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLockMatrixExplorer);
} else {
  initLockMatrixExplorer();
}
