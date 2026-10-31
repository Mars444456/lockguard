function features(org = {}) {
  const expiry = org.accessUntil === undefined ? null : Date.parse(org.accessUntil);
  const pro = org.plan === 'team' && org.subscriptionStatus === 'active' &&
    (expiry === null ? org.billingProvider !== 'robokassa' : Number.isFinite(expiry) && expiry > Date.now());
  return { pro, plan: pro ? 'pro' : 'community', savedSchemas: pro ? 10 : 0, historyLimit: pro ? 1000 : 100, compareRuns: pro };
}
function requirePro(store) {
  if (!features(store.getOrganization()).pro) throw Object.assign(new Error('Эта функция доступна в активном LockGuard Pro. Онлайн-оплата пока подключается; условия доступа уточняйте у исполнителя.'), { statusCode: 403 });
}
module.exports = { features, requirePro };
