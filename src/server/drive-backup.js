const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const META_KEY = 'drive_backup';
const ARCHIVE_NAME = /^lockguard-backup-[\dTZ-]+-[a-f0-9-]{36}\.sqlite3\.enc$/;
const runRclone = promisify(execFile);

function settings(env) {
  const token = env.LOCKGUARD_BACKUP_DRIVE_TOKEN;
  const folder = env.LOCKGUARD_BACKUP_DRIVE_FOLDER;
  const clientId = env.LOCKGUARD_BACKUP_DRIVE_CLIENT_ID;
  const clientSecret = env.LOCKGUARD_BACKUP_DRIVE_CLIENT_SECRET;
  if (!token && !folder && !clientId && !clientSecret) return { configured: false };
  let refreshToken;
  try { refreshToken = JSON.parse(token)?.refresh_token; } catch {}
  if (!env.LOCKGUARD_BACKUP_KEY || !folder || !/^[A-Za-z0-9_-]{10,128}$/.test(folder) ||
      typeof refreshToken !== 'string' || !refreshToken ||
      !clientId?.endsWith('.apps.googleusercontent.com') || !clientSecret) {
    return { configured: true };
  }
  return {
    configured: true, token, folder, clientId, clientSecret,
    destination: createHash('sha256').update(folder).digest('hex')
  };
}

function readState(db, destination) {
  if (!destination) return {};
  try {
    const state = JSON.parse(db.getMeta(META_KEY));
    if (state?.destination === destination) return state;
  } catch {}
  return { destination };
}

async function upload(file, config) {
  const name = path.basename(file);
  if (!path.isAbsolute(file) || !ARCHIVE_NAME.test(name) || !(await fs.lstat(file)).isFile()) {
    throw new Error('A completed encrypted backup file is required.');
  }
  const archive = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(36);
    const { bytesRead } = await archive.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || header.toString('ascii', 0, 8) !== 'LGBACK01') {
      throw new Error('A completed encrypted backup file is required.');
    }
  } finally {
    await archive.close();
  }
  // Restrict rclone to its own Drive files in the dedicated folder. Do not inherit app secrets.
  await runRclone('rclone', [
    'copyto', file, 'lockguardbackup:' + name, '--config=', '--immutable', '--checksum',
    '--retries=2', '--low-level-retries=2', '--contimeout=15s', '--timeout=45s', '--stats=0'
  ], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      RCLONE_CONFIG_LOCKGUARDBACKUP_TYPE: 'drive',
      RCLONE_CONFIG_LOCKGUARDBACKUP_SCOPE: 'drive.file',
      RCLONE_CONFIG_LOCKGUARDBACKUP_ROOT_FOLDER_ID: config.folder,
      RCLONE_CONFIG_LOCKGUARDBACKUP_CLIENT_ID: config.clientId,
      RCLONE_CONFIG_LOCKGUARDBACKUP_CLIENT_SECRET: config.clientSecret,
      RCLONE_CONFIG_LOCKGUARDBACKUP_TOKEN: config.token
    },
    timeout: 180000,
    maxBuffer: 65536,
    windowsHide: true
  });
}

function status(db, env, now, interval) {
  const config = settings(env);
  if (!config.destination) return { status: config.configured ? 'misconfigured' : 'disabled' };
  const state = readState(db, config.destination);
  const lastSuccessAt = state.lastSuccessAt || null;
  const timestamp = Date.parse(lastSuccessAt);
  const freshness = !lastSuccessAt ? 'never' :
    !Number.isFinite(timestamp) || timestamp > now || !Number.isFinite(interval) ? 'unknown' :
    now - timestamp > interval ? 'overdue' : 'ok';
  return {
    status: state.status === 'failed' || state.status === 'incomplete' ? state.status : freshness,
    lastAttemptAt: state.lastAttemptAt || null,
    lastSuccessAt,
    lastFailureAt: state.lastFailureAt || null
  };
}

module.exports = { META_KEY, settings, readState, upload, status };
