/**
 * LockGuard Web Dashboard Application Client
 */

let adminToken = '';
function setAdminToken() {
  const value = window.prompt('Токен администратора (оставьте пустым для выхода):');
  if (value === null) return;
  adminToken = value.trim();
  app.resetPrivateData();
  app.restoreAccount().then(() => app.refreshPrivateData());
}

async function apiFetch(url, options = {}) {
  if (window.location.protocol === 'file:') throw new Error('Откройте http://localhost:3000 после запуска npm start или используйте браузерное демо.');
  const headers = new Headers(options.headers);
  if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  if (!response.ok) {
    const data = await response.json();
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.status = response.status;
    if (response.status === 401 && !url.startsWith('/api/v1/auth/') && !adminToken) document.dispatchEvent(new Event('lockguard:signed-out'));
    throw error;
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

  safe_migration: `-- Fixture 10: example without known rule violations. Test on your own schema before deployment.

-- 1. Essential Safeguard: fail quickly instead of queueing behind long transactions
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- 2. Add column as nullable without default (Instant catalog change, no table rewrite)
ALTER TABLE accounts ADD COLUMN updated_at TIMESTAMP;

-- 3. Set default only for future incoming inserts
ALTER TABLE accounts ALTER COLUMN updated_at SET DEFAULT now();

-- 3b. Supporting index for Foreign Key (prevents table lock escalation on parent updates/deletes)
CREATE INDEX CONCURRENTLY idx_transactions_account_id ON transactions (account_id);

-- 4. Foreign Key: Add with NOT VALID (instant catalog lock)
ALTER TABLE transactions
  ADD CONSTRAINT fk_tx_account
  FOREIGN KEY (account_id)
  REFERENCES accounts(id)
  NOT VALID;


-- 5. Validate Foreign Key separately (takes only weak SHARE UPDATE EXCLUSIVE - writes proceed!)
ALTER TABLE transactions VALIDATE CONSTRAINT fk_tx_account;

-- 6. Concurrent Unique Index (Safe, no lock)
CREATE UNIQUE INDEX CONCURRENTLY idx_accounts_iban_unique ON accounts (iban);

-- 7. Attach Unique Constraint using existing concurrent index
ALTER TABLE accounts ADD CONSTRAINT uq_account_iban UNIQUE USING INDEX idx_accounts_iban_unique;

-- 8. Non-blocking index creation
CREATE INDEX CONCURRENTLY idx_transactions_created_at ON transactions (created_at);`
};

class LockGuardApp {
  constructor() {
    this.currentTab = 'playground';
    this.latestMarkdownReport = '';
    this.organization = null;
    this.account = null;
    this.identityVersion = 0;
    this.accountMode = 'login';
    this.registrationEnabled = true;
    this.analysisRequestId = 0;
    this.pro = window.LockGuardPro ? new window.LockGuardPro(this) : null;
    this.ready = this.init();
  }

  async init() {
    this.bindEvents();
    this.bindAccountEvents();
    if (window.location.protocol === 'file:') {
      document.getElementById('file-mode-notice').hidden = false;
      document.getElementById('sql-input').value = PRESETS.catastrophic;
      this.showAccountState();
      return;
    }
    await this.restoreAccount();
    this.loadPreset('catastrophic');
    await this.fetchRules();
    await this.refreshPrivateData();
    const paymentReturn = new URLSearchParams(window.location.search).get('payment');
    if (paymentReturn) {
      this.switchTab('billing');
      this.showToast(paymentReturn === 'cancelled' ? 'Оплата прервана. Заказ не активирован.' : 'Возврат с оплаты. Статус заказа проверяется по уведомлению Robokassa.');
    }
  }

  bindEvents() {
    document.getElementById('sql-input').addEventListener('input', () => {
      document.getElementById('current-filename').textContent = 'custom_migration.sql';
      this.invalidateAnalysis();
    });
    document.getElementById('sql-input').addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!document.getElementById('btn-analyze').disabled) this.analyzeCurrentSql(); }
    });
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

  bindAccountEvents() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.accountChannel = new BroadcastChannel('lockguard-account');
      this.accountChannel.onmessage = async () => {
        if (adminToken) return;
        this.resetPrivateData();
        await this.restoreAccount();
        await this.refreshPrivateData();
      };
    }
    document.getElementById('btn-account').addEventListener('click', () => this.toggleAccount());
    document.getElementById('btn-account-register').addEventListener('click', () => this.openRegistration());
    document.getElementById('btn-account-close').addEventListener('click', () => this.toggleAccount(false));
    document.getElementById('account-mode-login').addEventListener('click', () => this.setAccountMode('login'));
    document.getElementById('account-mode-register').addEventListener('click', () => this.setAccountMode('register'));
    document.getElementById('account-auth-form').addEventListener('submit', event => { event.preventDefault(); this.submitAccount(); });
    document.getElementById('btn-account-logout').addEventListener('click', () => this.signOut());
    document.addEventListener('lockguard:signed-out', () => { this.resetPrivateData(); this.showAccountState(); });
    document.getElementById('account-organization-form').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await apiFetch('/api/v1/organization', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: document.getElementById('account-organization-name').value.trim() }) });
        await this.fetchOrganization();
        this.accountMessage('Название сохранено.');
      } catch (error) { this.accountMessage(error.message); }
    });
    document.getElementById('account-password-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        await apiFetch('/api/v1/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: document.getElementById('account-current-password').value,
            password: document.getElementById('account-new-password').value }) });
        event.target.reset();
        this.accountChannel?.postMessage('changed');
        this.accountMessage('Пароль изменён. Остальные сеансы завершены.');
      } catch (error) { this.accountMessage(error.message); }
      finally { button.disabled = false; }
    });
  }

  accountMessage(text) { document.getElementById('account-message').textContent = text; }
  toggleAccount(open = document.getElementById('account-panel').hidden) {
    document.getElementById('account-panel').hidden = !open;
    document.getElementById('btn-account').setAttribute('aria-expanded', String(open));
    if (open) document.getElementById(this.account ? 'account-organization-name' : 'account-email').focus();
  }
  openRegistration() {
    this.toggleAccount(true);
    this.setAccountMode('register');
  }
  setAccountMode(mode) {
    this.accountMode = mode;
    const registration = mode === 'register';
    document.getElementById('account-organization-field').hidden = !registration;
    document.getElementById('account-organization').required = registration;
    document.getElementById('account-password').autocomplete = registration ? 'new-password' : 'current-password';
    document.getElementById('account-auth-submit').textContent = registration ? 'Создать аккаунт' : 'Войти';
    document.getElementById('account-mode-login').setAttribute('aria-pressed', String(!registration));
    document.getElementById('account-mode-register').setAttribute('aria-pressed', String(registration));
    this.accountMessage('');
  }
  showAccountState() {
    document.getElementById('account-guest').hidden = !!this.account;
    document.getElementById('account-profile').hidden = !this.account;
    document.getElementById('btn-account-logout').hidden = !this.account && !adminToken;
    document.getElementById('btn-account').textContent = this.account ? 'Личный кабинет' : adminToken ? 'Администратор' : 'Войти';
    document.getElementById('btn-account-register').hidden = !this.registrationEnabled || !!this.account || !!adminToken;
    document.getElementById('account-profile-email').textContent = this.account?.email || '';
  }
  resetPrivateData() {
    this.pro?.reset();
    this.identityVersion++;
    this.runs = [];
    const report = document.getElementById('run-report');
    if (report) { report.hidden = true; document.getElementById('run-report-body').textContent = ''; }
    this.analysisRequestId++;
    this.account = null;
    this.organization = null;
    this.latestMarkdownReport = '';
    for (const id of ['runs-tbody', 'keys-tbody', 'billing-orders', 'pr-markdown-box', 'violations-list']) document.getElementById(id)?.replaceChildren();
    document.getElementById('account-organization-name').value = '';
    document.getElementById('account-password-form').reset();
    document.getElementById('sql-input').value = '';
    document.getElementById('billing-payment-link').value = '';
    document.getElementById('billing-payment-section').hidden = true;
    document.getElementById('analysis-details').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('verdict-badge').textContent = 'Ожидает проверки';
    document.getElementById('verdict-badge').className = 'verdict-pill pending';
    document.getElementById('org-name').textContent = adminToken ? 'Администратор' : 'Гость';
    document.getElementById('org-plan-badge').textContent = 'Community';
    document.getElementById('org-plan-badge').className = 'plan-pill free';
  }
  async restoreAccount() {
    const identityVersion = this.identityVersion;
    try {
      const response = await apiFetch('/api/v1/auth/session');
      const data = await response.json();
      if (identityVersion !== this.identityVersion) return;
      this.account = adminToken ? null : data.user;
      this.registrationEnabled = data.registrationEnabled !== false;
      document.getElementById('account-mode-register').hidden = !this.registrationEnabled;
    } catch (error) { this.accountMessage('Не удалось подключиться к серверу: ' + error.message); }
    this.showAccountState();
  }
  async refreshPrivateData() {
    if (!this.account && !adminToken) return;
    await Promise.all([this.fetchOrganization(), this.fetchRuns(), this.fetchKeys()]);
    await this.pro?.refresh();
  }
  hasIdentity() { return !!this.account || !!adminToken; }
  async submitAccount() {
    const button = document.getElementById('account-auth-submit');
    button.disabled = true;
    this.accountMessage('');
    try {
      const response = await apiFetch('/api/v1/auth/' + this.accountMode, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('account-email').value.trim(), password: document.getElementById('account-password').value,
          organizationName: document.getElementById('account-organization').value.trim() }) });
      const data = await response.json();
      adminToken = '';
      this.resetPrivateData();
      this.account = data.user;
      this.accountChannel?.postMessage('changed');
      document.getElementById('account-auth-form').reset();
      this.showAccountState();
      await this.refreshPrivateData();
      this.accountMessage('Вы вошли. Ключи и история доступны только вашей организации.');
    } catch (error) { this.accountMessage(error.message); }
    finally { button.disabled = false; }
  }
  async signOut() {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      adminToken = '';
      this.resetPrivateData();
      this.accountChannel?.postMessage('changed');
      this.showAccountState();
      this.accountMessage('Вы вышли из аккаунта.');
    } catch (error) { this.accountMessage(error.message); }
  }

  switchTab(tabId) {
    window.scrollTo?.({top:0,behavior:'instant'});
    this.currentTab = tabId;
    document.querySelectorAll('.nav-tab').forEach(b => { b.classList.toggle('active', b.dataset.tab === tabId); b.setAttribute('aria-selected', String(b.dataset.tab === tabId)); });
    if (['runs', 'keys'].includes(tabId) && !this.account && !adminToken) { this.toggleAccount(true); this.accountMessage('Войдите, чтобы открыть данные своей организации.'); }
    if (tabId === 'runs' && (this.account || adminToken)) this.fetchRuns();
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
  }

  loadPreset(key) {
    const sql = PRESETS[key] || '';
    document.getElementById('sql-input').value = sql;
    document.getElementById('current-filename').textContent = `${key}_migration.sql`;
    this.invalidateAnalysis();
  }
  invalidateAnalysis() {
    this.analysisRequestId++;
    this.latestMarkdownReport='';
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('analysis-details').classList.add('hidden');
    document.getElementById('verdict-badge').className = 'verdict-pill pending';
    document.getElementById('verdict-badge').textContent = 'Ожидает проверки';
  }

  async analyzeCurrentSql() {
    const requestId = ++this.analysisRequestId, identityVersion = this.identityVersion;
    const sql = document.getElementById('sql-input').value.trim();
    if (!sql) {
      this.showToast('Вставьте SQL для проверки.');
      return;
    }

    const withContext = document.getElementById('chk-context')?.checked ?? true;
    const btn = document.getElementById('btn-analyze');
    btn.disabled = true;
    btn.textContent = 'Проверяем SQL…';

    try {
      const res = await apiFetch('/api/v1/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql,
          filename: document.getElementById('current-filename').textContent,
          withContext,
          recordRun: !!this.account,
          ...(this.pro?.selectedSchemaId() ? {schemaId:this.pro.selectedSchemaId()} : {})
        })
      });

      const data = await res.json();
      if (requestId !== this.analysisRequestId || identityVersion !== this.identityVersion) return;
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось проверить SQL');
      }

      this.renderAnalysis(data.data);
      this.pro?.renderContext(data.data);
    } catch (err) {
      if (identityVersion === this.identityVersion) this.showToast('Ошибка анализа: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Проверить SQL';
    }
  }

  async splitCurrentSql() {
    const identityVersion = this.identityVersion;
    const sql = document.getElementById('sql-input').value.trim();
    if (!sql) {
      this.showToast('Вставьте SQL для подготовки плана.');
      return;
    }

    const btn = document.getElementById('btn-split');
    btn.disabled = true;
    btn.textContent = 'Готовим план…';

    try {
      const res = await apiFetch('/api/v1/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, orm: 'sql', ...(this.pro?.selectedSchemaId() ? {schemaId:this.pro.selectedSchemaId()} : {}) })
      });

      const data = await res.json();
      if (identityVersion !== this.identityVersion) return;
      if (!res.ok) throw new Error(data.error || 'Не удалось подготовить план');

      if (data.plan.isSafe) {
        this.showToast('Правила не выявили нарушений. План изменений не требуется.');
      } else {
        const violationsList = document.getElementById('violations-list');
        violationsList.innerHTML = `
          <div style="background: rgba(6, 182, 212, 0.1); border: 1px solid var(--accent-cyan); border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
            <h4 style="color: var(--accent-cyan); margin-bottom: 0.5rem;">🔀 Черновой план: ${data.plan.totalPhases} этапов</h4>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Проверьте полноту и порядок этапов на тестовой базе перед применением.</p>
          </div>
        `;

        data.plan.phases.forEach(p => {
          const item = document.createElement('div');
          item.className = 'violation-card';
          item.style.borderLeftColor = 'var(--accent-cyan)';
          item.innerHTML = `
            <div class="violation-header">
              <span class="violation-title">Этап ${p.phaseNumber}: ${this.escapeHtml(p.title)}</span>
            </div>
            <div class="violation-desc" style="color: var(--text-muted);">${this.escapeHtml(p.description)}</div>
            <div class="fix-box">
              <div class="fix-header">
                <span>SQL для проверки</span>
                <button class="btn-secondary btn-xs btn-copy-snippet" data-fix="${encodeURIComponent(p.sql)}">Скопировать SQL</button>
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
            this.showToast('SQL этапа скопирован.');
          });
        });

        this.showToast(`Подготовлено этапов: ${data.plan.totalPhases}. Нужна ручная проверка.`);
      }
    } catch (err) {
      if (identityVersion === this.identityVersion) this.showToast('Ошибка подготовки плана: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'План изменений';
    }
  }

  renderAnalysis(result) {
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('analysis-details').classList.remove('hidden');

    const verdictBadge = document.getElementById('verdict-badge');
    if (result.passed && result.violationsCount > 0) {
      verdictBadge.className = 'verdict-pill warning';
      verdictBadge.textContent = `Замечания · ${result.violationsCount}`;
    } else if (result.passed) {
      verdictBadge.className = 'verdict-pill passed';
      verdictBadge.textContent = 'Нарушений правил нет';
    } else {
      verdictBadge.className = 'verdict-pill blocked';
      verdictBadge.textContent = 'Найдены риски';
    }

    // Metric tiles
    document.getElementById('res-max-lock').textContent = result.highestLockLevel;
    document.getElementById('res-lock-sub').textContent = window.LockGuardLabels?.impact[result.highestLockLevel] || result.lockImpact?.impact || 'Нет оценки блокировки';
    document.getElementById('res-violations-count').textContent = result.violationsCount;
    document.getElementById('res-violations-sub').textContent = `${result.criticalCount} критических, ${result.highCount} высоких`;
    document.getElementById('res-tables-count').textContent = result.affectedTables.length;
    document.getElementById('res-tables-list').textContent = result.affectedTables.join(', ') || 'Нет';

    // Violations List
    const violationsList = document.getElementById('violations-list');
    violationsList.innerHTML = '';

    if (result.violations.length === 0) {
      violationsList.innerHTML = `
        <div style="padding: 1.5rem; text-align: center; color: var(--accent-emerald); background: rgba(16, 185, 129, 0.1); border-radius: 8px;">
          ✔ <b>Правила не выявили нарушений.</b> Перед релизом проверьте схему, границы транзакций и нагрузку.
        </div>
      `;
    } else {
      result.violations.forEach((v, i) => {
        const item = document.createElement('div');
        item.className = `violation-card ${v.severity.toLowerCase()}`;
        item.innerHTML = `
          <div class="violation-header">
            <span class="violation-title">${i + 1}. ${window.LockGuardLabels?.titles[v.ruleId] || v.ruleName}</span>
            <span class="violation-tag ${v.severity.toLowerCase()}">${window.LockGuardLabels?.severity[v.severity] || v.severity}</span>
          </div>
          <div class="violation-meta">
            Правило: <b>${v.ruleId}</b> | Таблица: <b>${this.escapeHtml(v.table)}</b> | Блокировка: <b>${v.lockLevel}</b> | Строка: <b>L${v.line}</b>
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
                <span>Рекомендация для ручной проверки</span>
                <button class="btn-secondary btn-xs btn-copy-snippet" data-fix="${encodeURIComponent(v.safeFix)}">Скопировать SQL</button>
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
          this.showToast('SQL-рекомендация скопирована.');
        });
      });
    }

    // Markdown preview
    this.latestMarkdownReport = result.markdownReport;
    document.getElementById('pr-markdown-box').textContent = result.markdownReport;
  }

  async fetchOrganization() {
    const identityVersion = this.identityVersion;
    try {
      const res = await apiFetch('/api/v1/organization');
      const data = await res.json();
      if (identityVersion !== this.identityVersion) return;
      if (data.organization) {
        this.organization = data.organization;
        document.getElementById('account-organization-name').value = this.organization.name;
        document.getElementById('org-name').textContent = this.organization.name;
        const planPill = document.getElementById('org-plan-badge');
        planPill.className = `plan-pill ${this.organization.plan}`;
        planPill.textContent = this.organization.plan === 'team'
          ? `PRO${this.organization.accessUntil ? ' до ' + new Date(this.organization.accessUntil).toLocaleDateString('ru-RU') : ''}` : 'Community';
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
              <span class="violation-tag ${r.severity.toLowerCase()}">${window.LockGuardLabels?.severity[r.severity] || r.severity}</span>
            </div>
            <div class="rule-name">${window.LockGuardLabels?.titles[r.id] || r.name}</div>
            <div class="rule-desc">${r.description}</div>
          </div>
          <div class="rule-footer">
            <span>Блокировка: <b style="color: var(--accent-red);">${r.lockLevel}</b></span>
            <span>PostgreSQL</span>
          </div>
        `;
        grid.appendChild(card);
      });
    } catch (err) {
      console.warn('Failed to fetch rules:', err);
    }
  }

  async fetchRuns() {
    const identityVersion = this.identityVersion;
    try {
      const res = await apiFetch('/api/v1/runs');
      const data = await res.json();
      if (identityVersion !== this.identityVersion) return;
      const tbody = document.getElementById('runs-tbody');
      tbody.innerHTML = '';

      this.runs = data.runs;
      this.pro?.setRuns(data.runs);
      if (!data.runs.length) tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Здесь появятся ваши проверки. Начните с редактора SQL.</td></tr>';
      data.runs.forEach(run => {
        const tr = document.createElement('tr');
        const isPassed = run.status === 'PASSED';
        tr.innerHTML = `
          <td>
            <span class="verdict-pill ${isPassed ? 'passed' : 'blocked'}">
              ${isPassed ? 'Без нарушений' : 'Есть риски'}
            </span>
          </td>
          <td>
            <b>${this.escapeHtml(run.repo || (run.source === 'dashboard' ? 'SQL-проверка' : 'Проверка API'))}</b><br>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${run.prNumber ? 'PR #' + this.escapeHtml(run.prNumber) : 'Ручная проверка'}</span>
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
            <span style="font-size: 0.75rem; color: var(--text-dim);">(${run.criticalCount || 0} крит.)</span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.75rem;">
            ${new Date(run.timestamp).toLocaleTimeString()}
          </td>
          <td>
            <button class="btn-secondary btn-xs" onclick="app.viewRunDetails('${run.id}')">Открыть отчёт</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.warn('Failed to fetch runs:', err);
    }
  }

  async fetchKeys() {
    const identityVersion = this.identityVersion;
    try {
      const res = await apiFetch('/api/v1/keys');
      const data = await res.json();
      if (identityVersion !== this.identityVersion) return;
      const tbody = document.getElementById('keys-tbody');
      tbody.innerHTML = '';

      if (!data.keys.length) tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Ключей пока нет. Создайте ключ для подключения серверного API.</td></tr>';
      data.keys.forEach(k => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${this.escapeHtml(k.name)}</b></td>
          <td>
            <code>${k.key.substring(0, 10)}••••••••••••••••</code>
            <small>Секрет доступен только при создании</small>
          </td>
          <td style="font-size: 0.75rem; color: var(--text-muted);">${new Date(k.createdAt).toLocaleDateString()}</td>
          <td style="font-size: 0.75rem; color: var(--text-muted);">${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Ещё нет'}</td>
          <td>
            <span class="plan-pill ${k.status === 'active' ? 'team' : 'free'}">${k.status === 'active' ? 'Активен' : 'Отозван'}</span>
          </td>
          <td>
            ${k.status === 'active' ? `
              <button class="btn-secondary btn-xs" style="color: var(--accent-red);" onclick="app.revokeKey('${k.id}')">Отозвать</button>
            ` : '<span style="color: var(--text-dim); font-size: 0.75rem;">Отозван</span>'}
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
      this.showToast(`Тестовый PR #${prNumber} проверен: ${data.action.toUpperCase()}`);
      await this.fetchRuns();
    } catch (err) {
      this.showToast('Ошибка тестового PR: ' + err.message);
    }
  }

  async promptCreateKey() {
    const name = prompt('Название ключа API (например, GitHub Actions CI):');
    if (!name) return;

    try {
      const res = await apiFetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      this.showToast(`Ключ «${name}» создан.`);
      window.prompt('Сохраните ключ API сейчас. Повторно он не отображается:', data.key.key);
      await this.fetchKeys();
    } catch (err) {
      this.showToast('Ошибка создания ключа: ' + err.message);
    }
  }

  async revokeKey(id) {
    if (!confirm('Отозвать ключ API? Проверки CI, использующие этот ключ, перестанут работать.')) return;
    try {
      await apiFetch(`/api/v1/keys/${id}`, { method: 'DELETE' });
      this.showToast('Ключ API отозван.');
      await this.fetchKeys();
    } catch (err) {
      this.showToast('Ошибка отзыва ключа: ' + err.message);
    }
  }

  copyKey(key) {
    navigator.clipboard.writeText(key);
    this.showToast('Ключ API скопирован.');
  }

  viewRunDetails(runId) {
    const run = this.runs?.find(item => item.id === runId);
    if (!run) return;
    const panel = document.getElementById('run-report');
    panel.hidden = false;
    document.getElementById('run-report-body').textContent = run.markdownReport || run.summary || 'Подробный отчёт этой старой проверки не сохранён.';
    panel.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  async selectPlan(plan) {
    if (plan === 'free') { this.showToast('Бесплатный анализ доступен без оплаты.'); return; }
    if (!adminToken) {
      if (plan === 'business') window.location.href = 'mailto:minsafinmarsel02@gmail.com?subject=LockGuard%3A%20заказ%20аудита';
      else this.showToast('Онлайн-оплата подключается. Условия и контакты доступны на странице «Тарифы».');
      return;
    }
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
      this.showToast('Ошибка заказа: ' + err.message);
    } finally { this.paymentRequestInFlight = false; }
  }

  async fetchPaymentOrders() {
    const identityVersion = this.identityVersion;
    try {
      const res = await apiFetch('/api/v1/billing/orders');
      const { orders } = await res.json();
      if (identityVersion !== this.identityVersion) return;
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
        btn.textContent = 'Текущий план';
        btn.className = 'btn-plan btn-secondary';
        btn.disabled = true;
      } else {
        btn.disabled = false;
        btn.textContent = !adminToken ? (p === 'team' ? 'Подключение оплаты' : 'Обсудить аудит') : p === 'team' ? (currentPlan === 'team' ? 'Продлить на 30 дней — 1 500 ₽' : 'Оплатить 30 дней — 1 500 ₽') : 'Оплатить аудит — 30 000 ₽';
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
  'SHARE': ['ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'SHARE ROW EXCLUSIVE': ['ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'EXCLUSIVE': ['ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  'ACCESS EXCLUSIVE': [
    'ACCESS SHARE', 'ROW SHARE', 'ROW EXCLUSIVE', 'SHARE UPDATE EXCLUSIVE',
    'SHARE', 'SHARE ROW EXCLUSIVE', 'EXCLUSIVE', 'ACCESS EXCLUSIVE'
  ]
};

const PG_LOCK_DETAILS = {
  'ACCESS EXCLUSIVE': {
    title: '🚨 ACCESS EXCLUSIVE: Фатальная блокировка таблицы (Full Outage)',
    desc: 'Блокирует <b>абсолютно все операции</b>: чтение (<code>SELECT</code>), запись (<code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>), создание индексов и любые другие DDL/DML. Если в этот момент выполняется долгий аналитический запрос, DDL встает в очередь, а все последующие <code>SELECT</code> выстраиваются за ним (Head-of-Line Blocking), исчерпывая пул соединений и приводя к массовым ошибкам <b>HTTP 504 Gateway Timeout</b>.',
    blocked: ['SELECT (ACCESS SHARE)', 'INSERT / UPDATE / DELETE (ROW EXCLUSIVE)', 'CREATE INDEX (SHARE)', 'VACUUM / ANALYZE'],
    safe: []
  },
  'SHARE': {
    title: '⛔ SHARE: Блокировка пользовательской записи (Write Freeze)',
    desc: 'Позволяет продолжать чтение (<code>SELECT</code>), но <b>полностью блокирует все операции изменения данных</b>: <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>! Все пользовательские транзакции записи встают колом до тех пор, пока не построится весь индекс.',
    blocked: ['INSERT / UPDATE / DELETE (ROW EXCLUSIVE)', 'CREATE INDEX CONCURRENTLY (SHARE UPDATE EXCLUSIVE)', 'ALTER TABLE (ACCESS EXCLUSIVE)'],
    safe: ['Параллельные SELECT (ACCESS SHARE)', 'SELECT FOR UPDATE (ROW SHARE)']
  },
  'SHARE UPDATE EXCLUSIVE': {
    title: '✅ SHARE UPDATE EXCLUSIVE: Режим параллельных операций',
    desc: 'Совместим с обычным чтением и записью на уровне табличных блокировок. Конфликтует с другим SHARE UPDATE EXCLUSIVE и более сильными режимами. Это не гарантирует отсутствие ожиданий, нагрузки или блокировок других объектов.',
    blocked: ['Параллельный VACUUM / ANALYZE', 'Другой CREATE INDEX CONCURRENTLY', 'ALTER TABLE (ACCESS EXCLUSIVE)'],
    safe: ['Клиентские SELECT (ACCESS SHARE)', 'Клиентские INSERT / UPDATE / DELETE (ROW EXCLUSIVE)', 'SELECT FOR UPDATE']
  },
  'ROW EXCLUSIVE': {
    title: '⚡ ROW EXCLUSIVE: Стандартный рабочий поток записи данных',
    desc: 'Этот лок берется каждой стандартной операцией изменения данных на уровне строки (<code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>). Не мешает другим транзакциям читать или писать в другие строки, но мгновенно блокируется опасными DDL-миграциями.',
    blocked: ['CREATE INDEX (SHARE)', 'ALTER TABLE (ACCESS EXCLUSIVE)', 'TRUNCATE'],
    safe: ['Параллельные SELECT (ACCESS SHARE)', 'Параллельные INSERT/UPDATE (ROW EXCLUSIVE)', 'CREATE INDEX CONCURRENTLY']
  },
  'ACCESS SHARE': {
    title: '📖 ACCESS SHARE: Стандартный рабочий поток чтения',
    desc: 'Этот лок берется обычным <code>SELECT</code> запросом. Совместим со всеми остальными режимами, кроме самого тяжелого — <code>ACCESS EXCLUSIVE</code>. Длительное ожидание ACCESS EXCLUSIVE может задерживать последующие запросы.',
    blocked: ['ALTER TABLE (ACCESS EXCLUSIVE)', 'DROP TABLE', 'TRUNCATE'],
    safe: ['Параллельные SELECT (ACCESS SHARE)', 'INSERT / UPDATE / DELETE (ROW EXCLUSIVE)', 'CREATE INDEX CONCURRENTLY']
  },
  'EXCLUSIVE': {
    title: '🔒 EXCLUSIVE: Эксклюзивная блокировка записи и чтения с блокировками',
    desc: 'Блокирует все операции записи и параллельные индексы, но позволяет простое неблокирующее чтение <code>SELECT</code>.',
    blocked: ['INSERT / UPDATE / DELETE', 'SELECT FOR UPDATE', 'Параллельные CREATE INDEX'],
    safe: ['Простой SELECT (ACCESS SHARE)']
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
      td.textContent = isConflict ? 'ЖДЁТ' : 'OK';
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
      html += `<span class="explainer-tag tag-blocked">Ждёт: ${item}</span>`;
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
