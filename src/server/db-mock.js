const crypto = require('crypto');

class MockDatabase {
  constructor() {
    this.organization = {
      id: 'org_lockguard_default',
      name: 'Acme SaaS Engineering',
      plan: 'team', // 'free' | 'team' | 'business'
      stripeCustomerId: 'cus_mock_998811',
      subscriptionStatus: 'active',
      monthlyChecksQuota: 5000,
      checksUsedThisMonth: 142
    };

    this.apiKeys = [
      {
        id: 'key_1',
        name: 'CI/CD GitHub Action (Production)',
        key: process.env.DEFAULT_API_KEY || 'lg_live_demo998877665544332211',
        createdAt: '2026-10-15T09:00:00Z',
        lastUsedAt: '2026-10-29T10:45:00Z',
        status: 'active'
      },
      {
        id: 'key_2',
        name: 'Local Dev Staging CLI',
        key: 'lg_live_staging1234567890abcdef',
        createdAt: '2026-10-20T14:30:00Z',
        lastUsedAt: '2026-10-28T16:12:00Z',
        status: 'active'
      }
    ];

    this.runs = [
      {
        id: 'run_108',
        repo: 'acme/ecommerce-api',
        prNumber: 421,
        branch: 'feat/checkout-optimizations',
        commit: '7a9c2df',
        author: 'alex-backend',
        status: 'BLOCKED',
        highestLockLevel: 'ACCESS EXCLUSIVE',
        violationsCount: 3,
        criticalCount: 2,
        highCount: 1,
        timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
        summary: 'Blocked PR #421: Detected non-concurrent CREATE INDEX and ADD COLUMN with volatile DEFAULT.'
      },
      {
        id: 'run_107',
        repo: 'acme/ecommerce-api',
        prNumber: 420,
        branch: 'fix/safe-iban-unique-index',
        commit: '3f1b490',
        author: 'maria-dba',
        status: 'PASSED',
        highestLockLevel: 'SHARE UPDATE EXCLUSIVE',
        violationsCount: 0,
        criticalCount: 0,
        highCount: 0,
        timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
        summary: 'All checks passed: Concurrent index with zero downtime.'
      },
      {
        id: 'run_106',
        repo: 'acme/auth-service',
        prNumber: 88,
        branch: 'feat/user-audit-trail',
        commit: 'c5d2e01',
        author: 'dmitry-sec',
        status: 'BLOCKED',
        highestLockLevel: 'ACCESS EXCLUSIVE',
        violationsCount: 1,
        criticalCount: 1,
        highCount: 0,
        timestamp: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
        summary: 'Blocked PR #88: Missing NOT VALID on Foreign Key.'
      }
    ];
  }

  getOrganization() {
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
    return this.organization;
  }

  getApiKeys() {
    return this.apiKeys;
  }

  createApiKey(name = 'New API Key') {
    const rawKey = 'lg_live_' + crypto.randomBytes(16).toString('hex');
    const newRecord = {
      id: 'key_' + Date.now(),
      name,
      key: rawKey,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: 'active'
    };
    this.apiKeys.unshift(newRecord);
    return newRecord;
  }

  revokeApiKey(id) {
    const index = this.apiKeys.findIndex(k => k.id === id);
    if (index !== -1) {
      this.apiKeys[index].status = 'revoked';
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
      return found;
    }
    // Also allow DEFAULT_API_KEY
    if (key === (process.env.DEFAULT_API_KEY || 'lg_live_demo998877665544332211')) {
      this.organization.checksUsedThisMonth++;
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
    if (this.runs.length > 50) this.runs.pop();
    return newRun;
  }
}

const db = new MockDatabase();
module.exports = db;
