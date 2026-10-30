const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * LockGuard Persistent Database
 * 
 * Provides production-grade JSON file persistence for:
 * - Organization profile, quotas, and subscription plan
 * - Team API keys with last-used tracking
 * - Historical Pull Request audit runs and lock statistics
 * 
 * Zero external dependencies — pure Node.js standard library.
 */
class PersistentDatabase {
  constructor(options = {}) {
    this.dbFilePath = options.dbFilePath || process.env.LOCKGUARD_DB_FILE || path.join(process.cwd(), 'data', 'lockguard.db.json');
    this.memoryOnly = !!options.memoryOnly;

    this.organization = {
      id: 'org_lockguard_primary',
      name: process.env.LOCKGUARD_ORG_NAME || 'Engineering Team',
      plan: 'free', // 'free' | 'team' | 'business'
      subscriptionStatus: 'inactive',
      monthlyChecksQuota: 100,
      checksUsedThisMonth: 0,
      updatedAt: new Date().toISOString()
    };

    this.apiKeys = process.env.DEFAULT_API_KEY ? [
      {
        id: 'key_primary',
        name: 'CI/CD Primary Gatekeeper Key',
        keyHash: this._hashKey(process.env.DEFAULT_API_KEY),
        keyPrefix: process.env.DEFAULT_API_KEY.slice(0, 10),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        status: 'active'
      }
    ] : [];

    this.runs = [];
    this.paymentOrders = [];
    this.lastInvoiceId = 0;

    // Load from disk if available
    this._load();
  }

  _load() {
    if (this.memoryOnly) return;
    try {
      if (fs.existsSync(this.dbFilePath)) {
        const raw = fs.readFileSync(this.dbFilePath, 'utf8');
        const data = JSON.parse(raw);
        if (!data.organization || !Array.isArray(data.apiKeys) || !Array.isArray(data.runs)) throw new Error('Invalid database schema');
        if (data.organization) this.organization = { ...this.organization, ...data.organization };
        if (Array.isArray(data.apiKeys)) this.apiKeys = data.apiKeys;
        if (Array.isArray(data.runs)) this.runs = data.runs;
        if (data.paymentOrders !== undefined && !Array.isArray(data.paymentOrders)) throw new Error('Invalid payment orders');
        this.paymentOrders = data.paymentOrders || [];
        this.lastInvoiceId = data.lastInvoiceId || 0;
        this._diskRevision = raw;
        for (const record of this.apiKeys) {
          if (record.key) {
            record.keyHash = this._hashKey(record.key);
            record.keyPrefix = record.key.slice(0, 10);
            if (record.key === 'lg_live_demo998877665544332211') record.status = 'revoked';
            delete record.key;
          }
        }
        this._save();
      } else {
        this._save();
      }
    } catch (err) {
      throw new Error('Unable to load LockGuard database', { cause: err });
    }
  }

  _save() {
    if (this.memoryOnly) return;
    let lockFd;
    const lockPath = this.dbFilePath + '.lock';
    try {
      const dir = path.dirname(this.dbFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      lockFd = fs.openSync(lockPath, 'wx');
      const current = fs.existsSync(this.dbFilePath) ? fs.readFileSync(this.dbFilePath, 'utf8') : undefined;
      if (current !== this._diskRevision) throw new Error('Database changed in another process; restart to reload it');
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        organization: this.organization,
        apiKeys: this.apiKeys,
        runs: this.runs,
        paymentOrders: this.paymentOrders,
        lastInvoiceId: this.lastInvoiceId
      };
      const tmpPath = this.dbFilePath + '.tmp';
      const serialized = JSON.stringify(data, null, 2);
      fs.writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpPath, this.dbFilePath);
      this._diskRevision = serialized;
      this._savedState = JSON.stringify({ organization: this.organization, apiKeys: this.apiKeys, runs: this.runs, paymentOrders: this.paymentOrders, lastInvoiceId: this.lastInvoiceId });
    } catch (err) {
      if (this._savedState) Object.assign(this, JSON.parse(this._savedState));
      throw new Error('Unable to save LockGuard database', { cause: err });
    } finally {
      if (lockFd !== undefined) {
        fs.closeSync(lockFd);
        fs.unlinkSync(lockPath);
      }
    }
  }

  getOrganization() {
    if (this.organization.billingProvider === 'robokassa' && this.organization.accessUntil && Date.parse(this.organization.accessUntil) <= Date.now() && this.organization.plan !== 'free') {
      this.updateOrganization({ plan: 'free', subscriptionStatus: 'expired', monthlyChecksQuota: 100 });
    }
    return this.organization;
  }

  createPaymentOrder({ product, email, requestId, testMode, merchantLogin }) {
    const existing = this.paymentOrders.find(order => order.requestId === requestId);
    if (existing) {
      if (existing.productId !== product.id || existing.email !== email || existing.testMode !== testMode || existing.merchantLogin !== merchantLogin) throw new Error('Order idempotency key was reused with different parameters');
      return existing;
    }
    const nextInvoiceId = Math.max(this.lastInvoiceId + 1, Date.now() * 100 + crypto.randomInt(100));
    if (!Number.isSafeInteger(nextInvoiceId) || nextInvoiceId > 999999999999999) throw new Error('Invoice counter exhausted');
    this.lastInvoiceId = nextInvoiceId;
    const order = { id: String(this.lastInvoiceId), requestId, organizationId: this.organization.id,
      productId: product.id, amount: product.amount, currency: 'RUB', title: product.title, days: product.days,
      email, testMode, merchantLogin, status: 'pending', createdAt: new Date().toISOString() };
    this.paymentOrders.push(order);
    this._save();
    return order;
  }

  getPaymentOrder(id) { return this.paymentOrders.find(order => order.id === id); }
  getPaymentOrders() { return this.paymentOrders.map(({ requestId, ...order }) => ({ ...order })); }

  completePaymentOrder(id) {
    const order = this.getPaymentOrder(id);
    if (!order || order.organizationId !== this.organization.id) throw new Error('Payment organization mismatch');
    if (order.status === 'paid' || order.status === 'test_paid') return order;
    const now = Date.now();
    order.status = order.testMode ? 'test_paid' : 'paid';
    order.paidAt = new Date(now).toISOString();
    if (!order.testMode && order.productId === 'team') {
      const currentExpiry = this.organization.billingProvider === 'robokassa' ? Date.parse(this.organization.accessUntil) || 0 : 0;
      this.organization = { ...this.organization, billingProvider: 'robokassa', plan: 'team', subscriptionStatus: 'active',
        monthlyChecksQuota: 5000, accessUntil: new Date(Math.max(now, currentExpiry) + order.days * 86400000).toISOString(), updatedAt: order.paidAt };
      order.fulfillmentStatus = 'access_granted';
    } else if (!order.testMode) order.fulfillmentStatus = 'awaiting_audit';
    this._save(); // Payment receipt and entitlement are committed together for replay safety.
    return order;
  }

  updateOrganization(patch = {}) {
    this.organization = {
      ...this.organization,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this._save();
    return this.organization;
  }

  updatePlan(plan) {
    this.organization.plan = plan;
    this.organization.subscriptionStatus = 'active';
    if (plan === 'free') {
      this.organization.monthlyChecksQuota = 100;
    } else if (plan === 'team') {
      this.organization.monthlyChecksQuota = 5000;
    } else if (plan === 'business') {
      this.organization.monthlyChecksQuota = 50000;
    }
    this.organization.updatedAt = new Date().toISOString();
    this._save();
    return this.organization;
  }

  getApiKeys() {
    return this.apiKeys.map(({ keyHash, ...record }) => ({ ...record, key: `${record.keyPrefix || 'lg_'}…` }));
  }

  _hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  createApiKey(name = 'New API Key') {
    const rawKey = 'lg_live_' + crypto.randomBytes(16).toString('hex');
    const newRecord = {
      id: 'key_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: name || 'API Key',
      keyHash: this._hashKey(rawKey),
      keyPrefix: rawKey.slice(0, 10),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: 'active'
    };
    this.apiKeys.unshift(newRecord);
    this._save();
    const { keyHash, ...publicRecord } = newRecord;
    return { ...publicRecord, key: rawKey };
  }

  revokeApiKey(id) {
    const index = this.apiKeys.findIndex(k => k.id === id);
    if (index !== -1) {
      this.apiKeys[index].status = 'revoked';
      this._save();
      return true;
    }
    return false;
  }

  verifyApiKey(key) {
    this.getOrganization();
    if (typeof key !== 'string' || !key) return false;
    const hash = this._hashKey(key);
    const found = this.apiKeys.find(k => k.keyHash === hash && k.status === 'active');
    if (found) {
      found.lastUsedAt = new Date().toISOString();
      this.organization.checksUsedThisMonth++;
      this._save();
      return found;
    }
    return false;
  }

  getRuns() {
    return this.runs;
  }

  addRun(runData) {
    const newRun = {
      id: 'run_' + crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...runData
    };
    this.runs.unshift(newRun);
    if (this.runs.length > 100) this.runs.pop();
    this._save();
    return newRun;
  }

  clearRuns() {
    this.runs = [];
    this._save();
    return true;
  }
}

const db = new PersistentDatabase();
module.exports = db;
module.exports.PersistentDatabase = PersistentDatabase;
