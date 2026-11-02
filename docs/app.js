const escapeHtml = value => String(value ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const uiText = value => window.LockGuardI18n?.t(value) ?? value;
/**
 * LockGuard GitHub Pages Client Application
 * Powered 100% in-browser by LockGuard AST Engine
 */

const PRESETS = {
  catastrophic: `-- Illustrative combined migration risks
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

-- 4. Type change: review the source type and conversion
ALTER TABLE transactions ALTER COLUMN amount TYPE NUMERIC(18, 4);

-- 5. Direct Unique Constraint
ALTER TABLE accounts ADD CONSTRAINT uq_account_iban UNIQUE (iban);

-- 6. Direct DROP COLUMN (breaks running instances)
ALTER TABLE accounts DROP COLUMN legacy_pin;

COMMIT;`,

  add_column: `-- Unsafe ADD COLUMN with volatile default (full table rewrite)
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

ALTER TABLE users ADD CONSTRAINT uq_users_tax_id UNIQUE (tax_id);`,

  missing_timeout: `-- Missing SET lock_timeout directive (Head-of-Line Blocking risk!)
ALTER TABLE orders ADD COLUMN notes TEXT;`,

  drop_column: `-- Direct DROP COLUMN on production table (LG-006)
-- ACCESS EXCLUSIVE lock crashes active ORM models and replica queries!
SET lock_timeout = '3s';

ALTER TABLE users DROP COLUMN legacy_pin;`,

  unsafe_not_null: `-- Unsafe ALTER COLUMN SET NOT NULL (LG-009)
-- Scans entire table holding ACCESS EXCLUSIVE lock
SET lock_timeout = '3s';

ALTER TABLE users ALTER COLUMN email SET NOT NULL;`,

  concurrent_in_tx: `-- Forbidden CONCURRENTLY inside Transaction Block (LG-010)
-- PostgreSQL error: 25001 (cannot run CONCURRENTLY inside transaction)
BEGIN;

SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);

COMMIT;`,

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

class LockGuardWebPlayground {
  constructor() {
    this.sqlInput = document.getElementById('sql-input');
    this.presetSelect = document.getElementById('preset-select');
    this.btnExportPdf = document.getElementById('btn-export-pdf');
    this.btnAnalyze = document.getElementById('btn-analyze');
    this.btnSplit = document.getElementById('btn-split');
    this.btnClear = document.getElementById('btn-clear-sql');

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
    this.versionSelect = document.getElementById('version-select');
    this.btnDownloadMigration = document.getElementById('btn-download-migration');
    this.btnShare = document.getElementById('btn-share');
    this.btnCopyBadge = document.getElementById('btn-copy-badge');

    this.violationsList = document.getElementById('violations-list');
    this.splitterPhases = document.getElementById('splitter-phases');

    this.currentOrm = 'sql';
    this.lastAnalysis = null;
    document.addEventListener('lockguard:language', () => {
      if (this.lastAnalysis) this.renderAffectedTables(this.lastAnalysis);
    });

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
    if (this.versionSelect) {
      this.versionSelect.addEventListener('change', () => this.showEmptyState());
    }
    this.btnAnalyze.addEventListener('click', () => this.runAnalysis());
    this.btnSplit.addEventListener('click', () => this.runSplitter());
    if (this.btnDownloadMigration) {
      this.btnDownloadMigration.addEventListener('click', () => this.downloadSafeMigration());
    }
    if (this.btnExportPdf) {
      this.btnExportPdf.addEventListener('click', () => this.exportPdfReport());
    }
    this.btnClear.addEventListener('click', () => {
      this.sqlInput.value = '';
      this.showEmptyState();
    });

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
        const badgeMd = '[![Protected by LockGuard](https://img.shields.io/badge/PostgreSQL-Static_SQL_Checks-10B981?style=flat-square&logo=postgresql&logoColor=white)](https://github.com/Mars444456/lockguard)';
        navigator.clipboard.writeText(badgeMd).then(() => {
          this.btnCopyBadge.textContent = '✔ Markdown скопирован!';
          setTimeout(() => {
            this.btnCopyBadge.textContent = '📋 Скопировать Markdown';
          }, 2500);
        });
      });
    }

    this.sqlInput.addEventListener('input', () => {
      this.showEmptyState();
    });
    this.sqlInput.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !this.btnAnalyze.disabled) {
        event.preventDefault();
        this.runAnalysis();
      }
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
      this.showEmptyState();
    }
  }

  showEmptyState(errorMessage = '') {
    this.lastAnalysis = null;
    this.emptyState.classList.remove('hidden');
    this.analysisDetails.classList.add('hidden');
    this.splitterPanel.classList.add('hidden');
    this.verdictBadge.className = errorMessage ? 'verdict-pill failed' : 'verdict-pill pending';
    this.verdictBadge.textContent = errorMessage ? 'Ошибка анализа' : 'Ожидает проверки';
    this.emptyState.querySelector('h3').textContent = errorMessage ? 'Анализ не выполнен' : 'Проверьте ваш SQL';
    this.emptyState.querySelector('p').textContent = errorMessage || 'Проверка известных рисков SQL. Оценки нагрузки являются моделью и требуют проверки на вашей базе.';
  }

  async runAnalysis() {
    this.btnAnalyze.disabled = true;
    this.btnAnalyze.textContent = 'Проверяем…';
    this.analysisDetails.setAttribute('aria-busy', 'true');
    try { await window.LockGuard?.ready; return this.runAnalysisInternal(); }
    catch (error) {
      this.lastAnalysis = null;
      this.showEmptyState(error.message);
      return null;
    }
    finally {
      this.btnAnalyze.disabled = false;
      this.btnAnalyze.textContent = 'Проверить SQL';
      this.analysisDetails.setAttribute('aria-busy', 'false');
    }
  }

  runAnalysisInternal() {
    const sql = this.sqlInput.value.trim();
    if (!sql) {
      this.showEmptyState();
      return;
    }

    if (!window.LockGuard) {
      throw new Error('Движок анализа ещё не загрузился. Повторите проверку после загрузки страницы.');
    }

    const pgVersion = this.versionSelect ? Number(this.versionSelect.value) : 17;
    // Analyze the SQL without inventing workload measurements.
    const analysis = window.LockGuard.analyze(sql, { pgVersion });
    this.lastAnalysis = analysis;

    // Render static findings.
    this.emptyState.classList.add('hidden');
    this.analysisDetails.classList.remove('hidden');

    this.renderVerdict(analysis);
    this.renderMetrics(analysis);
    this.renderLockMatrix(analysis.highestLockLevel);
    this.renderViolations(analysis.violations);
    return analysis;
  }

  renderVerdict(analysis) {
    if(analysis.coverageComplete===false){this.verdictBadge.className='verdict-pill warning';this.verdictBadge.textContent='Есть исключённые проверки';return;}
    if (analysis.isDmlOnly) {
      this.verdictBadge.className = 'verdict-pill passed';
      this.verdictBadge.innerHTML = '✔ DML: ПРОВЕРКИ DDL НЕ ПРИМЕНЯЮТСЯ';
    } else if (analysis.passed && analysis.violationsCount > 0) {
      this.verdictBadge.className = 'verdict-pill warning';
      this.verdictBadge.textContent = `Замечания · ${analysis.violationsCount}`;
    } else if (analysis.passed) {
      this.verdictBadge.className = 'verdict-pill passed';
      this.verdictBadge.innerHTML = 'Нарушений правил нет';
    } else {
      this.verdictBadge.className = 'verdict-pill failed';
      this.verdictBadge.innerHTML = `Найдены риски · ${analysis.violationsCount}`;
    }
  }

  renderMetrics(analysis) {
    this.renderAffectedTables(analysis);
    if(this.dmlNotice) this.dmlNotice.classList.toggle('hidden',!analysis.isDmlOnly);
    if(this.dmlDesc) this.dmlDesc.textContent='Проверки DDL к этому скрипту не применяются. SQL не исполнялся; строковые блокировки и ожидания не измерены.';
    this.resMaxLock.textContent=analysis.highestLockLevel;
    this.resMaxLock.className='metric-value '+(analysis.highestLockLevel==='ACCESS EXCLUSIVE'?'text-red':'text-amber');
    this.resLockSub.textContent='Выведено из SQL; время удержания и ожидания не измерено';
    this.resViolationsCount.textContent=analysis.violationsCount;
    this.resViolationsSub.textContent=analysis.coverageComplete===false?'Есть отключённые или подавленные проверки':analysis.criticalCount+' критических, '+analysis.highCount+' высоких';
  }

  renderAffectedTables(analysis) {
    document.getElementById('res-affected-tables').textContent = analysis.affectedTables?.length
      ? uiText('Таблицы:') + ' ' + analysis.affectedTables.join(', ') : uiText('Затронутые таблицы не определены.');
  }

  renderLockMatrix(highestLock) {
    const conflicts = PG_LOCK_CONFLICTS[highestLock] || [];
    this.updateMatrixItem('matrix-select', conflicts.includes('ACCESS SHARE'));
    for (const command of ['insert', 'update', 'delete']) this.updateMatrixItem('matrix-' + command, conflicts.includes('ROW EXCLUSIVE'));
  }

  updateMatrixItem(id, isBlocked) {
    const el = document.getElementById(id);
    if (!el) return;
    if (isBlocked) {
      el.className = 'matrix-item blocked';
      el.querySelector('.matrix-status').textContent = 'Ждёт';
    } else {
      el.className = 'matrix-item allowed';
      el.querySelector('.matrix-status').textContent = 'Совместим';
    }
  }

  renderViolations(violations) {
    this.violationsList.innerHTML = '';
    if (!violations || violations.length === 0) {
      this.violationsList.innerHTML = '<div style="color:var(--accent-emerald); font-size:0.85rem; padding:0.5rem 0;">✔ Правила не выявили нарушений. Перед релизом нужна проверка на тестовой базе.</div>';
      return;
    }

    violations.forEach((v, idx) => {
      const card = document.createElement('div');
      card.className = `violation-card ${v.severity.toLowerCase()}`;
      card.innerHTML = `
        <div class="violation-header">
          <div class="violation-title">#${idx + 1}. ${window.LockGuardLabels?.titles[v.ruleId] || v.ruleName} (<code>${v.ruleId}</code>)</div>
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            ${v.isPhysicalTableRewrite ? '<span style="background:rgba(239,68,68,0.2); color:#F87171; border:1px solid rgba(239,68,68,0.4); padding:2px 6px; border-radius:4px; font-size:11px; font-weight:700;">💾 Рерайт диска</span>' : ''}
            ${v.rewriteReason === 'FAST_DEFAULT_METADATA_ONLY' ? '<span style="background:rgba(6,182,212,0.2); color:#22D3EE; border:1px solid rgba(6,182,212,0.4); padding:2px 6px; border-radius:4px; font-size:11px; font-weight:700;">⚡ Fast Default (Метаданные)</span>' : ''}
            <span class="badge-sev ${v.severity.toLowerCase()}">${window.LockGuardLabels?.severity[v.severity] || v.severity} • ${v.lockLevel}</span>
          </div>
        </div>
        <div class="violation-msg">
          <b>Таблица:</b> <code>${escapeHtml(v.table || 'unknown')}</code> | <b>Строка:</b> L${v.line || '1'}
          <details class="technical-message"><summary>Техническое описание</summary><p>${escapeHtml(v.message)}</p></details>
        </div>
        ${v.safeFix ? `
          <div class="safe-fix-box">
            <div class="safe-fix-header">
              <span>💡 Рекомендация для проверки</span>
              <button class="btn-secondary btn-xs btn-copy-fix">Скопировать SQL</button>
            </div>
            <details class="sql-recommendation"><summary>Показать SQL</summary><pre class="safe-fix-code">${escapeHtml(v.safeFix)}</pre></details>
          </div>
        ` : ''}
      `;

      const copyBtn = card.querySelector('.btn-copy-fix');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(v.safeFix);
          copyBtn.textContent = 'Скопировано';
          setTimeout(() => copyBtn.textContent = 'Скопировать SQL', 2000);
        });
      }

      window.LockGuardReview?.finding(card,v,this.sqlInput);
      this.violationsList.appendChild(card);
    });
  }

  async runSplitter() {
    const sql = this.sqlInput.value.trim();
    if (!sql) return;

    if (!await this.runAnalysis()) return;

    this.splitterPanel.classList.remove('hidden');
    this.renderSplitterPhases();
    this.splitterPanel.scrollIntoView({ behavior: 'smooth' });
  }

  renderSplitterPhases() {
    if (!this.lastAnalysis) return;
    if (this.lastAnalysis.analysisComplete === false) {
      this.splitterPhases.textContent = 'Разбиение недоступно: анализ неполный. Необходима ручная проверка SQL.';
      return;
    }
    const plan = window.LockGuard.generatePlan(this.lastAnalysis, this.currentOrm);
    this.splitterPhases.innerHTML = '';

    if ((!plan.phases || plan.phases.length === 0) && !plan.manualSteps?.length) {
      this.splitterPhases.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Нет нарушений, для которых доступен шаблон разбиения.</div>';
      return;
    }

    plan.phases.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'phase-card';
      const snippet = (plan.ormSnippets && plan.ormSnippets[idx])
        ? plan.ormSnippets[idx].code
        : (p.sql || p.code || '');
      const instruction = (plan.ormSnippets && plan.ormSnippets[idx] && plan.ormSnippets[idx].instruction)
        ? `<div style="font-size:0.75rem; color:var(--accent-cyan); margin-bottom:0.4rem; font-family:monospace;">${escapeHtml(plan.ormSnippets[idx].instruction)}</div>`
        : '';
      card.innerHTML = `
        <div class="phase-title">📦 [PHASE ${p.phaseNumber || (idx + 1)}]: ${escapeHtml(p.title)}</div>
        <div class="phase-desc">${escapeHtml(p.description)}</div>
        ${instruction}
        <pre class="phase-code">${escapeHtml(snippet)}</pre>
      `;
      this.splitterPhases.appendChild(card);
    });
  }

  async downloadSafeMigration() {
    if (!await this.runAnalysis()) return;
    if (this.lastAnalysis.analysisComplete === false) {
      this.showEmptyState('Разбиение недоступно: анализ неполный. Необходима ручная проверка SQL.');
      return;
    }
    const plan = window.LockGuard.generatePlan(this.lastAnalysis, this.currentOrm);
    if (!plan.phases || plan.phases.length === 0) {
      alert(uiText('Правила не выявили нарушений. Разбиение не требуется.'));
      return;
    }

    let fileContent = '';
    let fileName = 'safe_migration.sql';

    if (this.currentOrm === 'django') {
      fileName = '0042_lockguard_safe_migration.py';
      fileContent = (plan.ormSnippets && plan.ormSnippets[0])
        ? plan.ormSnippets.map(s => s.code).join('\n\n')
        : plan.phases.map(p => p.sql).join('\n\n');
    } else if (this.currentOrm === 'alembic') {
      fileName = 'alembic_safe_migration.py';
      fileContent = (plan.ormSnippets && plan.ormSnippets[0])
        ? plan.ormSnippets.map(s => s.code).join('\n\n')
        : plan.phases.map(p => p.sql).join('\n\n');
    } else {
      fileName = `${this.currentOrm}_safe_migration.sql`;
      fileContent = plan.phases.map((p, idx) => {
        const code = (plan.ormSnippets && plan.ormSnippets[idx]) ? plan.ormSnippets[idx].code : (p.sql || p.code || '');
        return `-- ==========================================\n-- [PHASE ${p.phaseNumber || (idx + 1)}]: ${escapeHtml(p.title)}\n-- ${escapeHtml(p.description)}\n-- ==========================================\n${code}`;
      }).join('\n\n');
    }

    fileContent += '\n\n'+(plan.manualSteps||[]).map(step=>'-- MANUAL REVIEW: '+step.ruleId+' '+step.table+'\n'+step.checks.map(check=>'-- '+check).join('\n')+'\n'+(step.verificationSql?'-- '+step.verificationSql:'')).join('\n\n');
    const blob = new Blob(['-- DRAFT: manual review required; compare with the complete original migration.\n' + fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async exportPdfReport() {
    const analysis = await this.runAnalysis();
    if (!analysis) return;

    const splitPlan = analysis.analysisComplete===false || analysis.coverageComplete===false ? {phases:[]} : window.LockGuard.generatePlan(analysis,'sql');
    const isSafe = analysis.passed && analysis.coverageComplete!==false;
    const dateStr = new Date().toLocaleDateString(window.LockGuardI18n?.locale || 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const violationsHtml = (analysis.violations || []).map((v, idx) => `
      <div style="border:1px solid #CBD5E1; border-left:4px solid ${v.severity === 'CRITICAL' ? '#DC2626' : '#D97706'}; border-radius:6px; padding:14px; margin-bottom:14px; background:#F8FAFC; page-break-inside:avoid;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <strong style="color:#0F172A; font-size:15px;">#${idx + 1}. ${window.LockGuardLabels?.titles[v.ruleId] || v.ruleName} (<code>${v.ruleId}</code>)</strong>
          <span style="background:${v.severity === 'CRITICAL' ? '#FEE2E2' : '#FEF3C7'}; color:${v.severity === 'CRITICAL' ? '#991B1B' : '#92400E'}; padding:2px 8px; border-radius:4px; font-weight:700; font-size:12px;">
            ${window.LockGuardLabels?.severity[v.severity] || v.severity} • ${v.lockLevel}
          </span>
        </div>
        <div style="font-size:13px; color:#334155; margin-bottom:8px;">
          <b>Таблица:</b> <code>${escapeHtml(v.table || 'default')}</code> | <b>Строка:</b> L${v.line || '1'}
          <br>${escapeHtml(v.message)}
        </div>
        ${v.safeFix ? `
          <div style="background:#0F172A; color:#E2E8F0; padding:10px 14px; border-radius:6px; font-family:Consolas, monospace; font-size:12px; line-height:1.5; white-space:pre-wrap;">
<span style="color:#38BDF8; font-weight:bold;">-- Черновая рекомендация для ручной проверки:</span>
<code data-i18n-ignore style="white-space:pre-wrap">${escapeHtml(v.safeFix)}</code>
          </div>
        ` : ''}
      </div>
    `).join('');

    const manualHtml=(splitPlan.manualSteps||[]).map(step=>`<section><h3>${escapeHtml(step.ruleId)} · Manual review</h3><p>${step.checks.map(escapeHtml).join('<br>')}</p></section>`).join('');
    const phasesHtml = (splitPlan.phases || []).map(p => `
      <div style="border:1px solid #E2E8F0; border-radius:6px; padding:12px; margin-bottom:10px; background:#F8FAFC; page-break-inside:avoid;">
        <div style="font-weight:700; color:#0F172A; font-size:14px; margin-bottom:4px;">📦 [ЭТАП ${p.phaseNumber}]: ${escapeHtml(p.title)}</div>
        <div style="font-size:12px; color:#475569; margin-bottom:8px;">${escapeHtml(p.description)}</div>
        <pre style="background:#0F172A; color:#4ADE80; padding:10px; border-radius:4px; font-family:Consolas, monospace; font-size:12px; line-height:1.4; margin:0; white-space:pre-wrap;">${escapeHtml(p.sql || p.code || '')}</pre>
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
      <div style="font-size:11px; color:#64748B;">Статический анализ • без исполнения SQL</div>
    </div>
  </div>

  <table class="meta-table">
    <tr>
      <td class="label">Объект аудита:</td>
      <td>Миграционный DDL-скрипт (PostgreSQL ${analysis.pgVersion})</td>
      <td class="label">Аудитор:</td>
      <td>LockGuard Automated AST Gatekeeper</td>
    </tr>
    <tr>
      <td class="label">Измерения:</td>
      <td>Длительность, ожидания и нагрузка не измерены</td>
      <td class="label">Контакты команды:</td>
      <td>Telegram: <b>@marswwu</b> | GitHub: Mars444456/lockguard</td>
    </tr>
  </table>

  <div class="banner ${analysis.isDmlOnly ? 'safe' : (isSafe ? 'safe' : 'critical')}">
    <div class="banner-title">${analysis.isDmlOnly ? 'DML: ПРОВЕРКИ DDL НЕ ПРИМЕНЯЮТСЯ' : (isSafe ? 'ПРАВИЛА НЕ ВЫЯВИЛИ НАРУШЕНИЙ' : 'НАЙДЕНЫ РИСКИ: НУЖНА ПРОВЕРКА')}</div>
    <div>${analysis.isDmlOnly
      ? 'Запрос читает или изменяет данные. Строковые блокировки и ожидания транзакций этой моделью не оцениваются. Время ожидания, насыщение пула и потери для DML не рассчитаны.'
      : (isSafe
        ? 'Проверенные правила не выявили нарушений. Результат не гарантирует отсутствие простоев; проверьте схему, нагрузку и транзакции на тестовой базе.'
        : 'В скрипте найдены замечания правил. Определённая по SQL максимальная блокировка: <b>' + escapeHtml(analysis.highestLockLevel || 'не определена') + '</b>. Длительность зависит от схемы, нагрузки и границ транзакций; SQL не исполнялся, показатели производительности не рассчитывались.')}</div>
  </div>

  <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr);">
    <div class="stat-box"><div class="stat-label">Макс. блокировка из SQL</div><div class="stat-val">${escapeHtml(analysis.highestLockLevel)}</div></div>
    <div class="stat-box"><div class="stat-label">Замечаний правил</div><div class="stat-val">${analysis.violationsCount}</div></div>
  </div>
  <p>Покрытие проверок: ${analysis.coverageComplete===false?'есть исключённые проверки — требуется ручной разбор':'все настроенные правила включены'}.</p>

  <h2>1. Анализ блокировок и найденные антипаттерны (${analysis.violationsCount})</h2>
  ${violationsHtml || '<p style="color:#16A34A;">Антипаттернов блокировок не обнаружено.</p>'}

  ${splitPlan.phases?.length || splitPlan.manualSteps?.length ? `
    <h2 style="page-break-before:always;">2. Черновой план изменений для ручной проверки</h2>
    <p style="font-size:12px; color:#475569; margin-bottom:12px;">Черновые этапы требуют ручной проверки полноты, порядка и применимости на тестовой базе:</p>
    ${phasesHtml}
    ${manualHtml}
  ` : ''}

  <h2>3. Заключение и экспертные рекомендации</h2>
  <ol style="padding-left:18px; font-size:12px; color:#334155; line-height:1.6;">
    <li><b>Интеграция в CI/CD:</b> Используйте проверенную версию анализатора, например <code>uses: Mars444456/lockguard@v1.4.1</code>, и просмотрите результат проверки миграции.</li>
    <li><b>Таймауты:</b> Подберите <code>lock_timeout</code> и <code>statement_timeout</code> под нагрузку и обработку ошибок. Они не гарантируют отсутствие задержек.</li>
    <li><b>Индексы:</b> Для занятой таблицы рассмотрите <code>CONCURRENTLY</code> вне транзакционного блока и проверьте ограничения этого режима.</li>
  </ol>

  <div class="footer">
    <div>Автоматический отчёт LockGuard • Для команды проверки</div>
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
      printWin.document.write(window.LockGuardI18n?.translateHtml(reportHtml) ?? reportHtml);
      printWin.document.close();
    } else {
      alert(uiText('Пожалуйста, разрешите открытие всплывающего окна в браузере, чтобы сформировать PDF-отчет.'));
    }
  }
}

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new LockGuardWebPlayground();
  initLockMatrixExplorer();
  if (window.location.hash === '#team-pilot') document.getElementById('team-pilot').scrollIntoView({ behavior: 'instant', block: 'start' });
});

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
    title: 'ACCESS EXCLUSIVE: конфликт со всеми табличными режимами',
    desc: 'Конфликтует со всеми табличными режимами блокировок, включая обычный SELECT. Ожидание DDL за долгой транзакцией может задержать последующие запросы. Длительность очереди и влияние на приложение зависят от транзакций, нагрузки, таймаутов и повторов; исчерпание пула и HTTP-ошибки не следуют из одного SQL.',
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
      td.textContent = isConflict ? '⛔ БЛОК' : '✔ ОК';
      td.title = `${reqLock} vs ${existLock}: ${isConflict ? 'КОНФЛИКТ' : 'СОВМЕСТИМЫ'}`;
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
    title: `ℹ️ ${lockMode}: Режим блокировки таблицы`,
    desc: `Блокирует операции, конфликтующие с данным уровнем блокировки согласно официальной спецификации PostgreSQL.`,
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
      html += `<span class="explainer-tag tag-blocked">⛔ Блокирует: ${item}</span>`;
    });
    (details.safe || []).forEach(item => {
      html += `<span class="explainer-tag tag-safe">✔ Совместим: ${item}</span>`;
    });
    tagsEl.innerHTML = html;
  }
}
