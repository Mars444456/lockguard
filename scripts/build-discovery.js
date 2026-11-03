const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const base = 'https://mars444456.github.io/lockguard/';
const pages = [
  ['index.html', 'LockGuard — PostgreSQL migration review', 'Review PostgreSQL migration SQL in your browser. 12 static checks, CLI and GitHub Action. Open source under MIT; no account required for the public SQL demo.'],
  ['start.html', 'Try LockGuard: a PostgreSQL migration before and after', 'A reproducible SQL example: inspect an index change, add schema context and compare findings. Static analysis with explicit limits.'],
  ['contacts.html', 'Contact LockGuard', 'Project contact and service details for LockGuard PostgreSQL migration review.'],
  ['offer.html', 'LockGuard — service terms', 'Terms, service scope, pricing and cancellation information for LockGuard.'],
  ['privacy.html', 'LockGuard — privacy', 'How LockGuard handles submitted information and the limits of the temporary test workspace.']
];
function escape(value) { return value.replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]); }
function buildDiscovery(root = path.resolve(__dirname, '..')) {
  const docs = path.join(root, 'docs'), assets = path.join(root, 'src/ui/assets');
  for (const name of ['social-card.png', 'favicon.svg']) fs.copyFileSync(path.join(assets, name), path.join(docs, name));
  const imageRevision = createHash('sha256').update(fs.readFileSync(path.join(assets, 'social-card.png'))).digest('hex').slice(0, 12);
  for (const [file, title, description] of pages) {
    const url = base + (file === 'index.html' ? '' : file);
    const tags = [
      `<link rel="canonical" href="${url}">`,
      '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="LockGuard">',
      `<meta property="og:title" content="${escape(title)}">`,
      `<meta property="og:description" content="${escape(description)}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:image" content="${base}social-card.png?v=${imageRevision}">`,
      '<meta property="og:image:type" content="image/png">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta property="og:image:alt" content="LockGuard: PostgreSQL migration SQL review, 12 checks, CLI and GitHub Action">',
      '<meta name="twitter:card" content="summary_large_image">'
    ].join('\n');
    const block = `<!-- discovery:start -->\n${tags}\n<!-- discovery:end -->`;
    const target = path.join(docs, file), html = fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n');
    fs.writeFileSync(target, html.includes('<!-- discovery:start -->') ? html.replace(/<!-- discovery:start -->[\s\S]*?<!-- discovery:end -->/, block) : html.replace('</head>', block + '\n</head>'));
  }
  fs.writeFileSync(path.join(docs, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + pages.map(([file]) => `  <url><loc>${base}${file === 'index.html' ? '' : file}</loc></url>`).join('\n') + '\n</urlset>\n');
}
if (require.main === module) buildDiscovery();
module.exports = { buildDiscovery };
