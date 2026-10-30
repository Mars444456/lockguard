const { timingSafeEqual } = require('crypto');

module.exports = function requireAdmin(req, res) {
  const expected = process.env.LOCKGUARD_ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'Administration is disabled. Configure LOCKGUARD_ADMIN_TOKEN on the server.' });
    return false;
  }
  const supplied = req.headers?.authorization || '';
  const actual = Buffer.from(supplied);
  const wanted = Buffer.from(`Bearer ${expected}`);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    res.status(401).json({ error: 'Administrator authentication required' });
    return false;
  }
  return true;
};
