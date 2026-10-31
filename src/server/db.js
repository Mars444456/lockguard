const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

const PRIMARY = 'org_lockguard_primary';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);
const defaults = id => ({ id, name: process.env.LOCKGUARD_ORG_NAME || 'Engineering Team', plan: 'free',
  subscriptionStatus: 'inactive', monthlyChecksQuota: 100, checksUsedThisMonth: 0, updatedAt: new Date().toISOString() });

class OrganizationStore {
  constructor(database, organizationId) { this.database = database; this.organizationId = organizationId; }
  get sql() { return this.database.sql; }
  getOrganization() {
    let org = this.database.readOrganization(this.organizationId);
    if (!org) throw new Error('Organization not found');
    if (org.billingProvider === 'robokassa' && Date.parse(org.accessUntil) <= Date.now() && org.plan !== 'free') {
      org = this.database.transaction(() => {
        const current = this.database.readOrganization(this.organizationId);
        return current.billingProvider === 'robokassa' && Date.parse(current.accessUntil) <= Date.now() && current.plan !== 'free'
          ? this.updateOrganization({ plan: 'free', subscriptionStatus: 'expired', monthlyChecksQuota: 100 }) : current;
      });
    }
    return org;
  }
  updateOrganization(patch = {}) {
    return this.database.transaction(() => {
      const current = this.database.readOrganization(this.organizationId);
      if (!current) throw new Error('Organization not found');
      const org = { ...current, ...patch, id: this.organizationId, updatedAt: new Date().toISOString() };
      this.sql.prepare('UPDATE organizations SET data=? WHERE id=?').run(json(org), this.organizationId);
      return org;
    });
  }
  updatePlan(plan) {
    if (!['free', 'team', 'business'].includes(plan)) throw new Error('Unknown plan');
    return this.updateOrganization({ plan, subscriptionStatus: 'active', monthlyChecksQuota: { free: 100, team: 5000, business: 50000 }[plan] });
  }
  getApiKeys() {
    return this.sql.prepare('SELECT data FROM api_keys WHERE organization_id=? ORDER BY rowid DESC').all(this.organizationId)
      .map(row => { const record = JSON.parse(row.data); return { ...record, key: record.keyPrefix + '…' }; });
  }
  createApiKey(name = 'New API Key') {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw Object.assign(new Error('Key name must contain 1–100 characters'), { statusCode: 400 });
    const key = 'lg_live_' + crypto.randomBytes(24).toString('hex');
    const record = { id: 'key_' + crypto.randomUUID(), organizationId: this.organizationId, name: name.trim(),
      keyPrefix: key.slice(0, 10), createdAt: new Date().toISOString(), lastUsedAt: null, status: 'active' };
    this.sql.prepare('INSERT INTO api_keys(id,organization_id,key_hash,data) VALUES(?,?,?,?)').run(record.id, this.organizationId, hash(key), json(record));
    return { ...record, key };
  }
  revokeApiKey(id) {
    return this.database.transaction(() => {
    const row = this.sql.prepare('SELECT data FROM api_keys WHERE id=? AND organization_id=?').get(id, this.organizationId);
    if (!row) return false;
    const record = { ...JSON.parse(row.data), status: 'revoked' };
    this.sql.prepare('UPDATE api_keys SET data=? WHERE id=? AND organization_id=?').run(json(record), id, this.organizationId);
    return true;
    });
  }
  verifyApiKey(key) { return this.database.findApiKey(key, this.organizationId); }
  recordCheck() {
    return this.database.transaction(() => {
      const org = this.getOrganization();
      const month = new Date().toISOString().slice(0, 7);
      this.updateOrganization({ checksMonth: month, checksUsedThisMonth: org.checksMonth === month ? org.checksUsedThisMonth + 1 : 1 });
    });
  }
  getRuns() {
    return this.sql.prepare('SELECT data FROM runs WHERE organization_id=? ORDER BY rowid DESC LIMIT 100').all(this.organizationId).map(row => JSON.parse(row.data));
  }
  addRun(runData) {
    return this.database.transaction(() => {
      const record = { ...runData, id: 'run_' + crypto.randomUUID(), organizationId: this.organizationId, timestamp: new Date().toISOString() };
      this.sql.prepare('INSERT INTO runs(id,organization_id,data) VALUES(?,?,?)').run(record.id, this.organizationId, json(record));
      this.sql.prepare('DELETE FROM runs WHERE organization_id=? AND id NOT IN (SELECT id FROM runs WHERE organization_id=? ORDER BY rowid DESC LIMIT 100)').run(this.organizationId, this.organizationId);
      return record;
    });
  }
  clearRuns() { this.sql.prepare('DELETE FROM runs WHERE organization_id=?').run(this.organizationId); return true; }
  createPaymentOrder({ product, email, requestId, testMode, merchantLogin }) {
    return this.database.transaction(() => {
      const existing = this.sql.prepare('SELECT data FROM payment_orders WHERE organization_id=? AND request_id=?').get(this.organizationId, requestId);
      if (existing) {
        const order = JSON.parse(existing.data);
        if (order.productId !== product.id || order.email !== email || order.testMode !== testMode || order.merchantLogin !== merchantLogin) throw new Error('Order idempotency key was reused with different parameters');
        return order;
      }
      const last = Number(this.database.getMeta('last_invoice_id') || 0);
      const id = Math.max(last + 1, Date.now() * 100 + crypto.randomInt(100));
      if (!Number.isSafeInteger(id) || id > 999999999999999) throw new Error('Invoice counter exhausted');
      this.database.setMeta('last_invoice_id', String(id));
      const order = { id: String(id), requestId, organizationId: this.organizationId, productId: product.id, amount: product.amount,
        currency: 'RUB', title: product.title, days: product.days, email, testMode, merchantLogin, status: 'pending', createdAt: new Date().toISOString() };
      this.sql.prepare('INSERT INTO payment_orders(id,organization_id,request_id,data) VALUES(?,?,?,?)').run(order.id, this.organizationId, requestId, json(order));
      return order;
    });
  }
  getPaymentOrder(id) {
    const row = this.sql.prepare('SELECT data FROM payment_orders WHERE id=? AND organization_id=?').get(id, this.organizationId);
    return row ? JSON.parse(row.data) : undefined;
  }
  getPaymentOrders() {
    return this.sql.prepare('SELECT data FROM payment_orders WHERE organization_id=? ORDER BY rowid DESC').all(this.organizationId)
      .map(row => { const { requestId, ...order } = JSON.parse(row.data); return order; });
  }
  completePaymentOrder(id) {
    return this.database.transaction(() => {
      const order = this.getPaymentOrder(id);
      if (!order) throw new Error('Payment organization mismatch');
      if (['paid', 'test_paid'].includes(order.status)) return order;
      const now = Date.now();
      order.status = order.testMode ? 'test_paid' : 'paid';
      order.paidAt = new Date(now).toISOString();
      if (!order.testMode && order.productId === 'team') {
        const org = this.getOrganization();
        const expiry = org.billingProvider === 'robokassa' ? Date.parse(org.accessUntil) || 0 : 0;
        this.updateOrganization({ billingProvider: 'robokassa', plan: 'team', subscriptionStatus: 'active', monthlyChecksQuota: 5000,
          accessUntil: new Date(Math.max(now, expiry) + order.days * 86400000).toISOString() });
        order.fulfillmentStatus = 'access_granted';
      } else if (!order.testMode) order.fulfillmentStatus = 'awaiting_audit';
      this.sql.prepare('UPDATE payment_orders SET data=? WHERE id=? AND organization_id=?').run(json(order), id, this.organizationId);
      return order;
    });
  }
}

class PersistentDatabase {
  constructor(options = {}) {
    this.memoryOnly = !!options.memoryOnly;
    const configured = options.dbFilePath || process.env.LOCKGUARD_DB_FILE;
    this.legacyFilePath = options.legacyFilePath || (configured?.endsWith('.json') ? configured : !configured ? path.join(process.cwd(), 'data', 'lockguard.db.json') : null);
    this.dbFilePath = this.memoryOnly ? ':memory:' : configured?.endsWith('.json') ? configured.replace(/\.json$/, '.sqlite3') :
      configured || path.join(process.cwd(), 'data', 'lockguard.sqlite3');
    this.depth = 0;
    try {
      if (!this.memoryOnly) fs.mkdirSync(path.dirname(this.dbFilePath), { recursive: true, mode: 0o700 });
      if (!this.memoryOnly) {
        fs.closeSync(fs.openSync(this.dbFilePath, 'a', 0o600));
        fs.chmodSync(this.dbFilePath, 0o600);
      }
      this.sql = new DatabaseSync(this.dbFilePath, { timeout: 5000 });
      // Rollback journaling also supports the SQLite bundled with Node 24.12,
      // which predates the upstream fix for the multi-connection WAL-reset bug.
      this.sql.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      this.sql.exec([
        'CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)))',
        'CREATE TABLE IF NOT EXISTS api_keys(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),key_hash TEXT NOT NULL UNIQUE,data TEXT NOT NULL CHECK(json_valid(data)))',
        'CREATE INDEX IF NOT EXISTS api_keys_org ON api_keys(organization_id)',
        'CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),data TEXT NOT NULL CHECK(json_valid(data)))',
        'CREATE INDEX IF NOT EXISTS runs_org ON runs(organization_id)',
        'CREATE TABLE IF NOT EXISTS payment_orders(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),request_id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(organization_id,request_id))',
        'CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),email TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)',
        'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
        'CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,started_at INTEGER NOT NULL,attempts INTEGER NOT NULL)'
      ].join(';'));
      const schema = this.getMeta('schema_version');
      if (schema && schema !== '1') throw new Error('Unsupported SQLite schema version');
      if (!schema) this.initialize();
      this.primaryOrganizationId = this.getMeta('primary_organization');
      if (!this.readOrganization(this.primaryOrganizationId)) throw new Error('Primary organization is missing');
      if (!this.memoryOnly) fs.chmodSync(this.dbFilePath, 0o600);
    } catch (cause) {
      this.sql?.close();
      throw new Error('Unable to load LockGuard database', { cause });
    }
  }
  initialize() {
    let legacy;
    if (!this.memoryOnly && this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
      if (fs.statSync(this.legacyFilePath).size > 32 * 1024 * 1024) throw new Error('Legacy database exceeds migration size limit');
      legacy = JSON.parse(fs.readFileSync(this.legacyFilePath, 'utf8'));
      if (!legacy.organization || Array.isArray(legacy.organization) || !Array.isArray(legacy.apiKeys) || !Array.isArray(legacy.runs) ||
        (legacy.paymentOrders !== undefined && !Array.isArray(legacy.paymentOrders))) throw new Error('Invalid legacy database schema');
      const copy = this.legacyFilePath + '.pre-sqlite-' + crypto.randomUUID() + '.bak';
      fs.copyFileSync(this.legacyFilePath, copy, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(copy, 0o600);
      fs.chmodSync(this.legacyFilePath, 0o600);
    }
    this.transaction(() => {
      if (this.getMeta('schema_version') === '1') return;
      const id = legacy?.organization.id || PRIMARY;
      this.sql.prepare('INSERT INTO organizations(id,data) VALUES(?,?)').run(id, json({ ...defaults(id), ...legacy?.organization, id }));
      this.setMeta('primary_organization', id);
      this.setMeta('last_invoice_id', String(legacy?.lastInvoiceId || 0));
      for (const key of legacy?.apiKeys || []) {
        const { key: raw, keyHash, ...record } = key;
        if (!raw && !keyHash) throw new Error('Invalid legacy API key');
        const data = { ...record, organizationId: id, keyPrefix: key.keyPrefix || raw?.slice(0, 10) || 'lg_',
          status: raw === 'lg_live_demo998877665544332211' || keyHash === hash('lg_live_demo998877665544332211') ? 'revoked' : key.status };
        this.sql.prepare('INSERT INTO api_keys(id,organization_id,key_hash,data) VALUES(?,?,?,?)').run(key.id, id, raw ? hash(raw) : keyHash, json(data));
      }
      if (!legacy && process.env.DEFAULT_API_KEY && process.env.DEFAULT_API_KEY !== 'lg_live_demo998877665544332211') {
        const raw = process.env.DEFAULT_API_KEY;
        const record = { id: 'key_primary', organizationId: id, name: 'CI/CD Primary Gatekeeper Key', keyPrefix: raw.slice(0, 10),
          createdAt: new Date().toISOString(), lastUsedAt: null, status: 'active' };
        this.sql.prepare('INSERT INTO api_keys(id,organization_id,key_hash,data) VALUES(?,?,?,?)').run(record.id, id, hash(raw), json(record));
      }
      // Reverse insertion keeps legacy newest-first histories in the same order.
      for (const run of [...legacy?.runs || []].reverse()) this.sql.prepare('INSERT INTO runs(id,organization_id,data) VALUES(?,?,?)').run(run.id, id, json({ ...run, organizationId: id }));
      for (const order of legacy?.paymentOrders || []) this.sql.prepare('INSERT INTO payment_orders(id,organization_id,request_id,data) VALUES(?,?,?,?)')
        .run(order.id, id, order.requestId, json({ ...order, organizationId: id }));
      this.setMeta('schema_version', '1');
      if (legacy) this.setMeta('legacy_migrated_at', new Date().toISOString());
    });
  }
  getMeta(key) { return this.sql.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value; }
  setMeta(key, value) { this.sql.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  transaction(callback) {
    if (this.depth) return callback();
    this.sql.exec('BEGIN IMMEDIATE');
    this.depth++;
    try { const result = callback(); this.sql.exec('COMMIT'); return result; }
    catch (cause) {
      this.sql.exec('ROLLBACK');
      if (!cause.code?.startsWith('ERR_SQLITE')) throw cause;
      throw new Error('Unable to save LockGuard database', { cause });
    }
    finally { this.depth--; }
  }
  readOrganization(id) {
    const row = this.sql.prepare('SELECT data FROM organizations WHERE id=?').get(id);
    return row ? JSON.parse(row.data) : null;
  }
  forOrganization(id = this.primaryOrganizationId) {
    if (!this.readOrganization(id)) throw new Error('Organization not found');
    return new OrganizationStore(this, id);
  }
  findApiKey(key, organizationId) {
    if (typeof key !== 'string' || key.length < 8 || key.length > 256) return false;
    return this.transaction(() => {
    const row = this.sql.prepare('SELECT organization_id,data FROM api_keys WHERE key_hash=?').get(hash(key));
    if (!row || (organizationId && row.organization_id !== organizationId)) return false;
    const record = JSON.parse(row.data);
    if (record.status !== 'active') return false;
    this.forOrganization(row.organization_id).getOrganization();
    record.lastUsedAt = new Date().toISOString();
    this.sql.prepare('UPDATE api_keys SET data=? WHERE id=?').run(json(record), record.id);
    return record;
    });
  }
  verifyApiKey(key) { return this.findApiKey(key); }
  createAccount({ email, passwordHash, organizationName }) {
    return this.transaction(() => {
      const id = 'org_' + crypto.randomUUID(), userId = 'user_' + crypto.randomUUID();
      const createdAt = new Date().toISOString();
      this.sql.prepare('INSERT INTO organizations(id,data) VALUES(?,?)').run(id, json({ ...defaults(id), name: organizationName }));
      this.sql.prepare('INSERT INTO users(id,organization_id,email,password_hash,created_at) VALUES(?,?,?,?,?)')
        .run(userId, id, email, passwordHash, createdAt);
      return { id: userId, email, organizationId: id, createdAt };
    });
  }
  getUserByEmail(email) {
    return this.sql.prepare('SELECT id,email,organization_id AS organizationId,password_hash AS passwordHash,created_at AS createdAt FROM users WHERE email=? COLLATE NOCASE').get(email);
  }
  createSession(userId, expectedPasswordHash) {
    const token = crypto.randomBytes(32).toString('hex'), now = Date.now();
    this.transaction(() => {
      if (expectedPasswordHash && this.sql.prepare('SELECT password_hash FROM users WHERE id=?').get(userId)?.password_hash !== expectedPasswordHash) {
        throw Object.assign(new Error('Учётные данные изменены. Войдите заново.'), { statusCode: 401 });
      }
      this.sql.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
      // Bound active sessions per account; concurrent logins do not create unlimited rows.
      this.sql.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 9)').run(userId, userId);
      this.sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(hash(token), userId, now, now + 7 * 86400000);
    });
    return token;
  }
  getSession(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const user = this.sql.prepare('SELECT u.id,u.email,u.organization_id AS organizationId,u.created_at AS createdAt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token), Date.now());
    return user || null;
  }
  deleteSession(token) { if (typeof token === 'string') this.sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); }
  changePassword(userId, passwordHash, expectedPasswordHash) {
    this.transaction(() => {
      if (expectedPasswordHash && this.sql.prepare('SELECT password_hash FROM users WHERE id=?').get(userId)?.password_hash !== expectedPasswordHash) {
        throw Object.assign(new Error('Учётные данные изменены. Войдите заново.'), { statusCode: 401 });
      }
      this.sql.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, userId);
      this.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    });
  }
  allowAuthAttempt(key, limit, windowMs) {
    return this.transaction(() => {
      const now = Date.now(), token = hash(key);
      this.sql.prepare('DELETE FROM auth_limits WHERE started_at<?').run(now - windowMs);
      const row = this.sql.prepare('SELECT attempts FROM auth_limits WHERE key=?').get(token);
      if (row?.attempts >= limit) return false;
      if (!row && this.sql.prepare('SELECT count(*) AS n FROM auth_limits').get().n >= 10000) return false;
      this.sql.prepare('INSERT INTO auth_limits(key,started_at,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(token, now);
      return true;
    });
  }
  async createBackup(directory = path.join(path.dirname(this.dbFilePath), 'backups'), retention = 7) {
    if (this.memoryOnly) throw new Error('Cannot back up an in-memory database');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const name = 'lockguard-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID() + '.sqlite3';
    const target = path.resolve(directory, name);
    await backup(this.sql, target);
    fs.chmodSync(target, 0o600);
    const check = new DatabaseSync(target, { readOnly: true });
    try {
      if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || check.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup integrity check failed');
    } finally { check.close(); }
    this.setMeta('last_backup_at', new Date().toISOString());
    const keep = Math.max(1, Math.min(Number(retention) || 7, 100));
    const files = fs.readdirSync(directory, { withFileTypes: true }).filter(e => e.isFile() && /^lockguard-backup-[\dTZ-]+-[a-f0-9-]{36}\.sqlite3$/.test(e.name))
      .map(e => ({ name: e.name, time: fs.statSync(path.join(directory, e.name)).mtimeMs })).sort((a, b) => b.time - a.time);
    for (const file of files.slice(keep)) fs.unlinkSync(path.resolve(directory, file.name));
    return target;
  }
  close() { this.sql?.close(); }
}

for (const method of ['getOrganization', 'updateOrganization', 'updatePlan', 'getApiKeys', 'createApiKey', 'revokeApiKey',
  'recordCheck', 'getRuns', 'addRun', 'clearRuns', 'createPaymentOrder', 'getPaymentOrder', 'getPaymentOrders', 'completePaymentOrder']) {
  PersistentDatabase.prototype[method] = function(...args) { return this.forOrganization()[method](...args); };
}

const db = new PersistentDatabase();
module.exports = db;
module.exports.PersistentDatabase = PersistentDatabase;
