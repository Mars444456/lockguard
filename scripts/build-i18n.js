const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function buildI18n(root = path.resolve(__dirname, '..')) {
  const assets = ['i18n-catalog.js', 'i18n.js', 'i18n.css'];
  const revisions = {};
  for (const asset of assets) {
    const bytes = fs.readFileSync(path.join(root, 'src/ui', asset), 'utf8').replaceAll('\r\n', '\n');
    fs.writeFileSync(path.join(root, 'docs', asset), bytes);
    revisions[asset] = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  }
  const tags = `<link rel="stylesheet" href="i18n.css?v=${revisions['i18n.css']}"><script src="i18n-catalog.js?v=${revisions['i18n-catalog.js']}"></script><script src="i18n.js?v=${revisions['i18n.js']}" defer></script>`;
  for (const directory of ['src/ui', 'docs']) for (const name of ['index.html', 'start.html', 'contacts.html', 'offer.html', 'privacy.html']) {
    const file = path.join(root, directory, name);
    if (!fs.existsSync(file)) continue;
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace(/\s*<!-- i18n:start -->[\s\S]*?<!-- i18n:end -->\s*/g, '');
    html = html.replace(/\s*<\/head>/, `\n<!-- i18n:start -->${tags}<!-- i18n:end -->\n</head>`);
    fs.writeFileSync(file, html);
  }
}
if (require.main === module) buildI18n();
module.exports = { buildI18n };
