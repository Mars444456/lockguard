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
      plan: 'team', // 'free' | 'team' | 'business'
      stripeCustomerId: null,
      subscriptionStatus: 'active',
      monthlyChecksQuota: 5000,
      checksUsedThisMonth: 0,
      updatedAt: new Date().toISOString()
    };

    this.apiKeys = [
      {
        id: 'key_primary',
        name: 'CI/CD Primary Gatekeeper Key',
        key: process.env.DEFAULT_API_KEY || 'lg_live_demo998877665544332211',
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        status: 'active'
      }
    ];

    this.runs = [];

    // Load from disk if available
    this._load();
  }

  _load() {
    if (this.memoryOnly) return;
    try {
      if (fs.existsSync(this.dbFilePath)) {
        const raw = fs.readFileSync(this.dbFilePath, 'utf8');
        const data = JSON.parse(raw);
        if (data.organization) this.organization = { ...this.organization, ...data.organization };
        if (Array.isArray(data.apiKeys)) this.apiKeys = data.apiKeys;
        if (Array.isArray(data.runs)) this.runs = data.runs;
      } else {
        this._save();
      }
    } catch (err) {
      // Fallback silently if read fails
    }
  }

  _save() {
    if (this.memoryOnly) return;
    try {
      const dir = path.dirname(this.dbFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        organization: this.organization,
        apiKeys: this.apiKeys,
        runs: this.runs
      };
      const tmpPath = this.dbFilePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.dbFilePath);
    } catch (err) {
      // Graceful fallback if filesystem is locked or read-only
    }
  }

  getOrganization() {
    return this.organization;
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
    return this.apiKeys;
  }

  createApiKey(name = 'New API Key') {
    const rawKey = 'lg_live_' + crypto.randomBytes(16).toString('hex');
    const newRecord = {
      id: 'key_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: name || 'API Key',
      key: rawKey,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: 'active'
    };
    this.apiKeys.unshift(newRecord);
    this._save();
    return newRecord;
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
    if (!key) return false;
    const found = this.apiKeys.find(k => k.key === key && k.status === 'active');
    if (found) {
      found.lastUsedAt = new Date().toISOString();
      this.organization.checksUsedThisMonth++;
      this._save();
      return found;
    }
    // Also allow DEFAULT_API_KEY
    if (key === (process.env.DEFAULT_API_KEY || 'lg_live_demo998877665544332211')) {
      this.organization.checksUsedThisMonth++;
      this._save();
      return { id: 'key_default', name: 'Default Key', plan: this.organization.plan };
    }
    return false;
  }

  getRuns() {
    return this.runs;
  }

  addRun(runData) {
    const newRun = {
      id: 'run_' + (this.runs.length + 101),
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
