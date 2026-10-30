const { createHash, timingSafeEqual } = require('node:crypto');
const catalog = require('./payment-catalog');
const database = require('./db');

function fail(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; throw error; }
function kopecks(value) {
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,6})?$/.test(value)) fail('Некорректная сумма платежа');
  const [whole, fraction = ''] = value.split('.');
  if (/[1-9]/.test(fraction.slice(2))) fail('Некорректная точность суммы платежа');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}
class RobokassaProvider {
  constructor({ db = database, env = process.env } = {}) { this.db = db; this.env = env; }
  credentials(testMode = this.env.ROBOKASSA_TEST_MODE !== 'false') {
    const prefix = testMode ? 'ROBOKASSA_TEST_' : 'ROBOKASSA_';
    const login = this.env.ROBOKASSA_MERCHANT_LOGIN;
    const password1 = this.env[`${prefix}PASSWORD1`], password2 = this.env[`${prefix}PASSWORD2`];
    if (!login || !password1 || !password2) fail('Robokassa не настроена: укажите идентификатор магазина и два пароля выбранного режима.', 503);
    if (password1 === password2) fail('Пароли №1 и №2 должны различаться.', 503);
    if (!testMode && [this.env.ROBOKASSA_TEST_PASSWORD1, this.env.ROBOKASSA_TEST_PASSWORD2].some(p => p && [password1, password2].includes(p))) fail('Рабочие и тестовые пароли должны различаться.', 503);
    const algorithm = (this.env.ROBOKASSA_HASH_ALGORITHM || 'sha256').toLowerCase();
    if (!['sha256', 'sha512', 'md5'].includes(algorithm)) fail('Неизвестный алгоритм подписи Robokassa.', 503);
    return { login, password1, password2, testMode, algorithm };
  }
  checkout({ plan, email, requestId }) {
    if (!Object.hasOwn(catalog, plan)) fail('Неизвестный продукт');
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Укажите email покупателя');
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) fail('Нужен уникальный идентификатор заказа');
    const credentials = this.credentials();
    const product = catalog[plan];
    // The invoice, amount and mode are persisted before the signed payment form leaves the server.
    const order = this.db.createPaymentOrder({ product, email, requestId, testMode: credentials.testMode, merchantLogin: credentials.login });
    if (order.status !== 'pending') fail('Этот заказ уже оплачен. Создайте новый заказ.', 409);
    const receipt = encodeURIComponent(JSON.stringify({ items: [{ name: order.title, quantity: 1, sum: Number(order.amount), tax: 'none' }] }));
    const signature = createHash(credentials.algorithm).update(`${credentials.login}:${order.amount}:${order.id}:${receipt}:${credentials.password1}`).digest('hex');
    const fields = { MerchantLogin: credentials.login, OutSum: order.amount, InvId: order.id,
      Description: order.title, Email: order.email, Culture: 'ru', Encoding: 'utf-8',
      Receipt: receipt, SignatureValue: signature, ...(credentials.testMode ? { IsTest: '1' } : {}) };
    const action = 'https://auth.robokassa.ru/Merchant/Index.aspx';
    return { success: true, configured: true, provider: 'robokassa', orderId: order.id, plan, currency: 'RUB',
      amount: order.amount, testMode: order.testMode, paymentStatus: 'pending',
      paymentForm: { action, method: 'POST', fields }, url: `${action}?${new URLSearchParams(fields)}` };
  }
  process(parameters) {
    const { OutSum, InvId, SignatureValue } = parameters;
    if (typeof InvId !== 'string' || !/^[1-9]\d{0,14}$/.test(InvId)) fail('Некорректный номер заказа');
    const order = this.db.getPaymentOrder(InvId);
    if (!order) fail('Заказ не найден', 404);
    if (Object.keys(parameters).some(key => key.startsWith('Shp_'))) fail('Неожиданные параметры платежа');
    const credentials = this.credentials(order.testMode);
    if (order.merchantLogin !== credentials.login) fail('Заказ относится к другому магазину', 409);
    if (kopecks(OutSum) !== kopecks(order.amount)) fail('Сумма платежа не совпадает с заказом');
    const expected = createHash(credentials.algorithm).update(`${OutSum}:${InvId}:${credentials.password2}`).digest('hex');
    if (typeof SignatureValue !== 'string' || !/^[a-f0-9]+$/i.test(SignatureValue) || SignatureValue.length !== expected.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(SignatureValue.toLowerCase()))) fail('Неверная подпись Robokassa', 401);
    this.db.completePaymentOrder(order.id);
    return `OK${order.id}`;
  }
}
module.exports = RobokassaProvider;
