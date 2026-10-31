const fs = require('node:fs');
const path = require('node:path');

function siteConfig(value) {
  const donation = new URL(value.donationUrl);
  if (donation.protocol !== 'https:' || donation.username || donation.password) throw new Error('Donation URL must use HTTPS without credentials.');
  let applicationUrl = '';
  if (value.applicationUrl) {
    const application = new URL(value.applicationUrl);
    if (application.protocol !== 'https:' || application.username || application.password ||
        application.search || application.hash || application.pathname !== '/' ||
        application.hostname === 'localhost' || application.hostname.endsWith('.github.io')) {
      throw new Error('Application URL must be the root HTTPS address of the deployed LockGuard server, not GitHub Pages.');
    }
    applicationUrl = application.origin + '/#account';
  }
  return { donationUrl: donation.href, applicationUrl };
}

function escapeHtml(value) { return value.replace(/[&"<>']/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;' })[c]); }
function replaceSection(html, name, content) {
  const marker = new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`);
  if (!marker.test(html)) throw new Error(`Missing ${name} markers.`);
  return html.replace(marker, () => `<!-- ${name}:start -->\n${content}\n<!-- ${name}:end -->`);
}

function buildSiteLinks(root = path.resolve(__dirname, '..')) {
  const config = siteConfig(JSON.parse(fs.readFileSync(path.join(root, 'config/site.json'), 'utf8')));
  const donationUrl = escapeHtml(config.donationUrl);
  const support = fs.readFileSync(path.join(root, 'src/ui/support.html'), 'utf8').trim().replaceAll('{{donationUrl}}', donationUrl);
  const seller = JSON.parse(fs.readFileSync(path.join(root, 'config/seller.json'), 'utf8'));
  if (!/^[^\s@<>"&]+@[^\s@<>"&]+\.[^\s@<>"&]+$/.test(seller.email)) throw new Error('Invalid pilot contact email.');
  const pilotEmail = 'mailto:' + seller.email + '?subject=' + encodeURIComponent('LockGuard: пилотная проверка миграций') + '&body=' + encodeURIComponent('Здравствуйте! Хотим обсудить пилот LockGuard.\n\nPostgreSQL и версия:\nИнструмент миграций (Prisma / Drizzle / SQL / другой):\nКак сейчас проверяем миграции:\n\nПароли, ключи и данные пользователей не прикладываем.');
  const pilot = fs.readFileSync(path.join(root, 'src/ui/pilot.html'), 'utf8').trim().replaceAll('{{pilotEmail}}', escapeHtml(pilotEmail));
  const donateLink = `<a class="btn-secondary donation-link" href="${donationUrl}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">♡</span> Донат</a>`;
  for (const directory of ['src/ui', 'docs']) {
    const file = path.join(root, directory, 'index.html');
    let html = fs.readFileSync(file, 'utf8');
    html = replaceSection(html, 'support-nav', donateLink);
    html = replaceSection(html, 'support-project', support);
    html = replaceSection(html, 'team-pilot', pilot);
    if (directory === 'docs') {
      const login = config.applicationUrl
        ? `<a id="public-account-link" class="btn-primary" href="${escapeHtml(config.applicationUrl)}">Войти</a>`
        : '<a id="public-account-link" class="btn-primary" href="#account-access" aria-haspopup="dialog" aria-controls="account-access-dialog">Войти</a>';
      html = replaceSection(html, 'public-account', login);
    }
    fs.writeFileSync(file, html);
  }
}

if (require.main === module) buildSiteLinks();
module.exports = { siteConfig, buildSiteLinks };
