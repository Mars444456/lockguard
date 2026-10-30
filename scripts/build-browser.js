const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { createHash } = require('node:crypto');
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/browser-entry.js')],
  outfile: path.join(__dirname, '../docs/lockguard-engine.js'), bundle: true, platform: 'browser',
  format: 'iife', external: ['fs', 'path', 'child_process', 'node:fs', 'node:path', 'node:crypto'],
  minify: true, legalComments: 'eof' });
fs.copyFileSync(require.resolve('libpg-query/wasm/libpg-query.wasm'), path.join(__dirname, '../docs/libpg-query.wasm'));
// The npm artifact is executable on Unix; published static assets must have a stable mode.
fs.chmodSync(path.join(__dirname, '../docs/libpg-query.wasm'), 0o644);
// GitHub Pages caches assets independently from HTML; change URLs whenever JS changes.
const indexPath = path.join(__dirname, '../docs/index.html');
const html = fs.readFileSync(indexPath, 'utf8').replace(/src="(app\.js|lockguard-engine\.js)(?:\?[^"\s]*)?"/g, (_, asset) => {
  const revision = createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../docs', asset))).digest('hex').slice(0, 12);
  return `src="${asset}?v=${revision}"`;
});
fs.writeFileSync(indexPath, html);
