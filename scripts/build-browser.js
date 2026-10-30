const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/browser-entry.js')],
  outfile: path.join(__dirname, '../docs/lockguard-engine.js'), bundle: true, platform: 'browser',
  format: 'iife', external: ['fs', 'path', 'child_process', 'node:fs', 'node:path', 'node:crypto'],
  minify: true, legalComments: 'eof' });
fs.copyFileSync(require.resolve('libpg-query/wasm/libpg-query.wasm'), path.join(__dirname, '../docs/libpg-query.wasm'));
// The npm artifact is executable on Unix; published static assets must have a stable mode.
fs.chmodSync(path.join(__dirname, '../docs/libpg-query.wasm'), 0o644);
