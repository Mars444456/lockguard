const seller = require('../../config/seller.json');
const catalog = require('./payment-catalog');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

class BillingService {
  /**
   * Generates a review-only invoice template. Bank details must be supplied separately.
   */
  static generateB2BInvoice({ companyName, inn, plan = 'team', email = '' }) {
    if (!Object.hasOwn(catalog, plan)) {
      const error = new Error('Unknown payment plan');
      error.statusCode = 400;
      throw error;
    }
    const product = catalog[plan];
    const amountRub = Number(product.amount);
    const invoiceNum = 'LG-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(100 + Math.random() * 900);
    const dateFormatted = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    const itemName = product.title;

    return {
      success: true,
      invoiceNumber: invoiceNum,
      templateOnly: true,
      date: dateFormatted,
      amountRub,
      companyName: companyName || 'Не указано',
      inn: inn || 'Не указан',
      html: `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Счет на оплату № ${invoiceNum}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; color: #000; padding: 25px; line-height: 1.4; max-width: 800px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    .border-table th, .border-table td { border: 1px solid #000; padding: 6px 8px; }
    .border-table th { background: #F3F4F6; font-weight: bold; text-align: center; }
    .bank-table td { border: 1px solid #000; padding: 5px 8px; }
    .header-title { font-size: 18px; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 15px; }
    .total-line { font-size: 14px; font-weight: bold; text-align: right; margin-top: 10px; }
    .sign-block { margin-top: 40px; display: flex; justify-content: space-between; }
    .print-btn { background: #2563EB; color: #FFF; border: none; padding: 10px 20px; font-weight: bold; border-radius: 6px; cursor: pointer; margin-bottom: 20px; }
    @media print { .print-btn { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <p style="border:2px solid #b45309;padding:12px"><b>ОБРАЗЕЦ — НЕ ДЛЯ ОПЛАТЫ.</b> Банковские реквизиты не заданы. Запросите настоящий счёт у исполнителя: ${escapeHtml(seller.email)}.</p>
  <button class="print-btn" onclick="window.print()">📥 Распечатать / Сохранить в PDF</button>

  <div style="font-size: 11px; color: #666; margin-bottom: 10px;">
    Шаблон для согласования заказа. Условия оказания услуг: ${escapeHtml(seller.siteUrl)}offer.html
  </div>

  <div class="header-title">
    Счет на оплату № ${invoiceNum} от ${dateFormatted} г.
  </div>

  <div style="margin-bottom: 8px;">
    <b>Исполнитель:</b> ${escapeHtml(seller.name)}, ИНН ${escapeHtml(seller.inn)}.<br>
    ${escapeHtml(seller.status)}. Email: ${escapeHtml(seller.email)}.
  </div>
  <div style="margin-bottom: 18px;">
    <b>Заказчик:</b> ${escapeHtml(companyName || 'Не указан')}, ИНН: ${escapeHtml(inn || 'Не указан')}
  </div>

  <table class="border-table">
    <thead>
      <tr>
        <th style="width: 5%;">№</th>
        <th style="width: 60%;">Товары (работы, услуги)</th>
        <th style="width: 10%;">Кол-во</th>
        <th style="width: 10%;">Ед.</th>
        <th style="width: 15%;">Цена, руб.</th>
        <th style="width: 15%;">Сумма, руб.</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align: center;">1</td>
        <td>${itemName}</td>
        <td style="text-align: center;">1</td>
        <td style="text-align: center;">усл.</td>
        <td style="text-align: right;">${amountRub.toLocaleString('ru-RU')},00</td>
        <td style="text-align: right;">${amountRub.toLocaleString('ru-RU')},00</td>
      </tr>
    </tbody>
  </table>

  <div class="total-line">
    Стоимость заказа: ${amountRub.toLocaleString('ru-RU')},00 руб.
  </div>

  <div style="margin-top: 15px; font-size: 12px;">
    Всего наименований 1, на сумму ${amountRub.toLocaleString('ru-RU')},00 руб.<br>
    Для оплаты необходим настоящий счёт с реквизитами исполнителя или подтверждённая платёжная ссылка.
  </div>

  <div class="sign-block">
    <div>
      Исполнитель: ________________ (${escapeHtml(seller.name)})
    </div>
  </div>
</body>
</html>`
    };
  }
}

module.exports = BillingService;
