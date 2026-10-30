const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'docs/index.html');
let html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('    <!-- Pricing & Commercial Monetization Section -->');
const end = html.indexOf('  </main>', start);
if (start < 0 || end < 0) throw new Error('Pricing section boundaries not found');
const pricing = `    <!-- Pricing & Commercial Monetization Section -->
    <section id="pricing" class="pricing-section">
      <div class="pricing-header"><h2 class="pricing-title">Услуги и стоимость</h2>
        <p class="pricing-subtitle">Бесплатный анализ, доступ Pro на 30 дней и разовый технический аудит. Автоматических списаний нет.</p></div>
      <div class="pricing-grid">
        <div class="pricing-card"><div class="pricing-name">Community</div>
          <div class="pricing-price">0 ₽ <span class="pricing-period">/ без оплаты</span></div>
          <div class="pricing-desc">Открытое ядро и браузерная демонстрация анализа SQL.</div>
          <ul class="pricing-features"><li><span class="check">✔</span> Анализ SQL в браузере</li><li><span class="check">✔</span> Каталог правил блокировок PostgreSQL</li><li><span class="check">✔</span> Открытый исходный код и локальный CLI</li></ul>
          <a href="#tab-playground" class="pricing-btn btn-free">Открыть бесплатный анализ</a></div>
        <div class="pricing-card featured"><div class="pricing-badge">ДОСТУП НА 30 ДНЕЙ</div>
          <div class="pricing-name">LockGuard Pro</div><div class="pricing-price">1 500 ₽ <span class="pricing-period">/ 30 дней</span></div>
          <div class="pricing-desc">Доступ к согласованному размещённому экземпляру LockGuard и поддержка по его использованию.</div>
          <ul class="pricing-features"><li><span class="check">✔</span> Адрес экземпляра и возможности подтверждаются до оплаты</li><li><span class="check">✔</span> 30 дней с активации после подтверждения платежа</li><li><span class="check">✔</span> Продление отдельной разовой оплатой</li><li><span class="check">✔</span> Поддержка по email</li></ul>
          <a href="contacts.html" class="pricing-btn btn-pro">Условия и заказ Pro</a>
          <a href="offer.html#refund" class="pricing-btn btn-free">Порядок отказа и возврата</a></div>
        <div class="pricing-card"><div class="pricing-name">Аудит SQL-миграций</div>
          <div class="pricing-price">30 000 ₽ <span class="pricing-period">/ разовый заказ</span></div>
          <div class="pricing-desc">Техническая проверка согласованного набора миграций PostgreSQL.</div>
          <ul class="pricing-features"><li><span class="check">✔</span> Объём, материалы и срок согласуются письменно до оплаты</li><li><span class="check">✔</span> Электронный отчёт о выявленных рисках</li><li><span class="check">✔</span> Рекомендации по изменению миграций</li><li><span class="check">✔</span> Внедрение и дополнительные работы согласуются отдельно</li></ul>
          <a href="mailto:minsafinmarsel02@gmail.com?subject=LockGuard%3A%20заказ%20аудита" class="pricing-btn btn-enterprise">Согласовать аудит по email</a></div>
      </div>
      <div id="payment-methods" class="payment-methods-box">
        <h3>Оплата и получение услуги</h3>
        <p>Онлайн-оплата через Robokassa находится на этапе подключения. Перед оплатой согласуйте заказ по <a href="mailto:minsafinmarsel02@gmail.com">minsafinmarsel02@gmail.com</a>. Платёжная ссылка предоставляется для согласованного заказа после подключения магазина.</p>
        <p>Расчёты — в рублях. При подключённом магазине способы оплаты выбираются на защищённой странице Robokassa. Данные карты на сайте LockGuard не вводятся. Чек предоставляется самозанятым в установленном порядке; автоматическая выдача зависит от подключения сервиса чеков.</p>
        <p>Доставка только электронная: доступ к сервису или отчёт по согласованному каналу. Доступ Pro предоставляется после подтверждения платежа, аудит — в срок, согласованный в заказе. Если услуга не оказана, обратитесь за возвратом; подробнее — <a href="offer.html#refund">условия отказа и возврата</a>.</p>
        <p>Статический анализ не гарантирует отсутствие всех дефектов и простоев. Перед применением миграции необходима проверка на тестовой базе.</p>
        <p><a href="contacts.html">Контакты и реквизиты</a> · <a href="offer.html">Публичная оферта</a> · <a href="privacy.html">Конфиденциальность</a></p>
      </div>
    </section>
`;
html = html.slice(0, start) + pricing + html.slice(end);
html = html.replace(/\s*<!-- Modal: 30-Day Free Pro Trial Activation -->[\s\S]*?<!-- Scripts -->/, '\n  <!-- Scripts -->');
html = html.replace('Командная подписка: 1 500 ₽/мес (30 дней бесплатно)', 'Pro: 1 500 ₽ за 30 дней, без автосписаний')
  .replace('Подписка Pro (1 500 ₽/мес)', 'Доступ Pro (1 500 ₽ / 30 дней)').replace('30 ДНЕЙ ТРИАЛ', '30 ДНЕЙ ДОСТУПА');
fs.writeFileSync(file, html);
console.log('Public pricing aligned with seller documents.');
