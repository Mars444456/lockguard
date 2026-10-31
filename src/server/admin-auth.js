const { timingSafeEqual } = require('crypto');

function isAdmin(req) {
  const expected = process.env.LOCKGUARD_ADMIN_TOKEN;
  if (!expected) return false;
  const actual = Buffer.from(req.headers?.authorization || '');
  const wanted = Buffer.from(`Bearer ${expected}`);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

module.exports = function requireAdmin(req, res) {
  const expected = process.env.LOCKGUARD_ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'Administration is disabled. Configure LOCKGUARD_ADMIN_TOKEN on the server.' });
    return false;
  }
  if (!isAdmin(req)) {
    res.status(401).json({ error: 'Administrator authentication required' });
    return false;
  }
  return true;
};
module.exports.isAdmin = isAdmin;
