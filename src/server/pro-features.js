function features(org = {}, env = process.env) {
  const freeBeta = env.LOCKGUARD_FREE_BETA !== 'false';
  const expiry = org.accessUntil === undefined ? null : Date.parse(org.accessUntil);
  const paidPro = org.plan === 'team' && org.subscriptionStatus === 'active' &&
    (expiry === null ? org.billingProvider !== 'robokassa' : Number.isFinite(expiry) && expiry > Date.now());
  const pro = freeBeta || paidPro;
  return { pro, freeBeta, plan: freeBeta ? 'free_beta' : pro ? 'pro' : 'community', savedSchemas: pro ? 10 : 0, historyLimit: pro ? 1000 : 100, compareRuns: pro,
    teamReviews:pro, members:pro ? 20 : 1, reviewLimit:pro ? 100 : 0 };
}
function requirePro(store) {
  if (!features(store.getOrganization()).pro) throw Object.assign(new Error('Эта функция доступна в активном LockGuard Pro. Онлайн-оплата пока подключается; условия доступа уточняйте у исполнителя.'), { statusCode: 403 });
}
module.exports = { features, requirePro };
