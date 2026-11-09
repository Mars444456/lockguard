const test = require('node:test');
const assert = require('node:assert/strict');
const { railwaySettings } = require('../scripts/railway-server');

const env = {
  RAILWAY_VOLUME_MOUNT_PATH: '/data',
  RAILWAY_PUBLIC_DOMAIN: 'cabinet.example.invalid'
};
const root = '20 10 0:1 / / rw - overlay overlay rw';
const mounted = root + '\n22 20 8:1 /vol /data rw - ext4 /dev/example rw';

test('Railway settings use the attached volume and public origin for the durable cabinet', () => {
  assert.deepEqual(railwaySettings(env, mounted), {
    APP_URL: 'https://cabinet.example.invalid',
    LOCKGUARD_DURABLE_STORAGE: 'true',
    LOCKGUARD_DB_FILE: '/data/lockguard.sqlite3',
    LOCKGUARD_BACKUP_DIR: '/data/backups'
  });
});

test('Railway refuses an ephemeral directory even if the mount variable is set', () => {
  assert.throws(() => railwaySettings(env, root), /Attach a Railway volume/);
  assert.throws(() => railwaySettings(env, mounted.replace(' /data ', ' /data-other ')), /Attach a Railway volume/);
  assert.throws(() => railwaySettings({ ...env, RAILWAY_VOLUME_MOUNT_PATH: '' }, mounted), /Attach a Railway volume/);
});

test('Railway requires the generated public domain before starting the cabinet', () => {
  for (const domain of ['', 'cabinet.example.invalid/path', 'cabinet.example.invalid:1234', 'user@cabinet.example.invalid']) {
    assert.throws(() => railwaySettings({ ...env, RAILWAY_PUBLIC_DOMAIN: domain }, mounted), /public domain/);
  }
});
