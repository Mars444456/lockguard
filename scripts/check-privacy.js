const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const chatLink = /https?:\/\/(?:(?:www\.)?chatgpt\.com\/(?:s|share|c)\/|chat\.openai\.com\/share\/)[^\s<>"')\]]+/i;
const privateKey = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
const binaryAsset = /\.(?:wasm|png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|gz)$/i;
const legalLocation = /^(?:config\/seller\.json|(?:docs|src\/ui)\/(?:contacts|offer|privacy)\.html)$/;
const localFileLink = /file:\/\/\/[a-z]:[\\/]/i;
const personalHome = /[a-z]:[\\/]Users[\\/](?!Public[\\/]|Default[\\/])[^\\/\s]+[\\/]/i;

function privatePath(file) {
  const name = path.posix.basename(file);
  return /^(?:private|data|backups|reports)\//i.test(file) ||
    /^(?:IDEA\.md|docs\/habr[^/]*|src\/ui\/habr\.html)$/i.test(file) ||
    (/^\.env(?:\.|$)/i.test(name) && name !== '.env.example') ||
    /\.(?:sqlite3?|db)(?:-(?:wal|shm)|\.(?:bak|backup|json))?$/i.test(name) ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(name);
}

function git(cwd, args, input) {
  try {
    return execFileSync('git', args, { cwd, input, maxBuffer: 128 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch {
    throw new Error('Privacy check could not read the Git index. Publication must stop.');
  }
}

function scanRepository(cwd = root) {
  const sellerFile = path.join(cwd, 'config/seller.json');
  let sellerValues = [];
  if (fs.existsSync(sellerFile)) {
    const seller = JSON.parse(fs.readFileSync(sellerFile, 'utf8'));
    sellerValues = [seller.name, seller.inn, seller.email].filter(value => typeof value === 'string' && value.length > 3);
  }
  const entries = git(cwd, ['ls-files', '--cached', '--stage', '-z']).toString('utf8')
    .split('\0').filter(Boolean).map(record => {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(record);
      if (!match || match[3] !== '0') throw new Error('Privacy check requires a resolved Git index.');
      return { mode: match[1], oid: match[2], file: match[4] };
    });
  const findings = new Map();
  const add = (file, rule, line = 0) => findings.set(`${file}\0${rule}\0${line}`, { file, rule, line });
  const inspect = (file, bytes) => {
    if (bytes.includes(0)) return;
    bytes.toString('utf8').split(/\r?\n/).forEach((line, index) => {
      // JSON sometimes escapes URL slashes. Never include the matched text in logs.
      const normalized = line.replaceAll('\\/', '/');
      if (chatLink.test(normalized)) add(file, 'conversation-link', index + 1);
      if (privateKey.test(line)) add(file, 'private-key', index + 1);
      if (localFileLink.test(normalized) || personalHome.test(normalized)) add(file, 'local-personal-path', index + 1);
      if (!legalLocation.test(file) && sellerValues.some(value => normalized.includes(value))) add(file, 'seller-details-outside-documents', index + 1);
    });
  };
  const textEntries = [];
  for (const entry of entries) {
    if (privatePath(entry.file)) add(entry.file, 'private-file');
    else if (!binaryAsset.test(entry.file) && /^100/.test(entry.mode)) textEntries.push(entry);
  }
  if (textEntries.length) {
    // Inspect the index too: cleaning a working file does not clean its staged copy.
    const batch = git(cwd, ['cat-file', '--batch'], textEntries.map(e => e.oid).join('\n') + '\n');
    let offset = 0;
    for (const entry of textEntries) {
      const end = batch.indexOf(10, offset);
      const header = batch.subarray(offset, end).toString('ascii');
      const match = /^([a-f0-9]+) blob (\d+)$/.exec(header);
      if (end < offset || !match || match[1] !== entry.oid) throw new Error('Privacy check could not inspect a tracked file.');
      const size = Number(match[2]);
      offset = end + 1;
      if (offset + size >= batch.length || batch[offset + size] !== 10) throw new Error('Incomplete privacy scan.');
      inspect(entry.file, batch.subarray(offset, offset + size));
      offset += size + 1;
      const file = path.join(cwd, entry.file);
      try {
        if (fs.lstatSync(file).isFile()) inspect(entry.file, fs.readFileSync(file));
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('Privacy check could not read a working file.');
      }
    }
  }
  return { checkedFiles: entries.length, findings: [...findings.values()] };
}

function assertPublishable(cwd = root) {
  const result = scanRepository(cwd);
  if (result.findings.length) {
    const locations = result.findings.map(f => `  ${JSON.stringify(f.file)}${f.line ? ':' + f.line : ''} [${f.rule}]`).join('\n');
    throw new Error(`Publication blocked by privacy check:\n${locations}\nRemove these items from both working files and the Git index. Matched contents are intentionally omitted.`);
  }
  return result;
}

if (require.main === module) {
  try {
    const result = assertPublishable();
    console.log(`Privacy check passed (${result.checkedFiles} tracked files).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { scanRepository, assertPublishable };
