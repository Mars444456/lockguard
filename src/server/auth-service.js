const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { isIP } = require('node:net');
const derive = promisify(scrypt);
const COOKIE = 'lockguard_session';
const DUMMY = 'scrypt$32768$8$3$' + '00'.repeat(16) + '$' + '00'.repeat(64);
let activeHashes = 0;

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) fail('Укажите корректный email.');
  return value.trim().toLowerCase();
}
function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || Buffer.byteLength(value) > 256) fail('Пароль должен содержать от 12 до 128 символов (до 256 байт).');
  return value;
}
async function passwordKey(password, salt) {
  if (activeHashes >= 2) fail('Сервис входа занят. Повторите запрос через несколько секунд.', 429);
  activeHashes++;
  try { return await derive(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }); }
  finally { activeHashes--; }
}
async function hashPassword(password) {
  passwordValue(password);
  const salt = randomBytes(16).toString('hex');
  return 'scrypt$32768$8$3$' + salt + '$' + (await passwordKey(password, salt)).toString('hex');
}
async function verifyPassword(password, stored = DUMMY) {
  const parts = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if (!parts) return false;
  const actual = await passwordKey(password, parts[1]);
  return timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}

class AuthService {
  constructor(db, env = process.env) { this.db = db; this.env = env; }
  cookieName() { return this.secure() ? '__Host-' + COOKIE : COOKIE; }
  secure() { return this.env.NODE_ENV === 'production' || this.env.APP_URL?.startsWith('https://'); }
  token(req) {
    const cookie = req.headers?.cookie;
    if (typeof cookie !== 'string' || cookie.length > 4096) return null;
    const values = cookie.split(';').map(v => v.trim()).filter(v => v.startsWith(this.cookieName() + '='));
    return values.length === 1 ? values[0].slice(this.cookieName().length + 1) : null;
  }
  authenticate(req) { return this.db.getSession(this.token(req)); }
  validateMutation(req) {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return;
    if (this.env.NODE_ENV === 'production' && !this.env.APP_URL?.startsWith('https://')) fail('Для аккаунтов настройте APP_URL с HTTPS.', 503);
    if (req.headers?.['sec-fetch-site'] === 'cross-site') fail('Запрос с другого сайта запрещён.', 403);
    const origin = req.headers?.origin;
    const allowed = this.env.APP_URL ? new URL(this.env.APP_URL).origin : 'http://' + req.headers?.host;
    if (origin && origin !== allowed) fail('Источник запроса не совпадает с адресом приложения.', 403);
    if (req.method !== 'DELETE' && (req.headers?.['content-type'] || '').split(';')[0] !== 'application/json') fail('Требуется Content-Type: application/json.', 415);
  }
  setCookie(res, token) {
    res.setHeader('Set-Cookie', this.cookieName() + '=' + (token || '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (token ? 604800 : 0) + (this.secure() ? '; Secure' : ''));
    res.setHeader('Cache-Control', 'no-store');
  }
  limit(req, email) {
    let ip = req.socket?.remoteAddress || 'local';
    const trusted = (this.env.LOCKGUARD_TRUST_PROXY_IPS || '').split(',').map(value => value.trim()).filter(Boolean);
    const forwarded = req.headers?.['x-forwarded-for'];
    if (trusted.includes(ip) && typeof forwarded === 'string' && forwarded.length < 1024) {
      const candidate = forwarded.split(',').at(-1).trim();
      if (isIP(candidate)) ip = candidate;
    }
    if (!this.db.allowAuthAttempt('ip:' + ip, 30, 15 * 60000) || !this.db.allowAuthAttempt('account:' + email, 10, 15 * 60000)) fail('Слишком много попыток. Повторите через 15 минут.', 429);
  }
  response(user) { return { success: true, user, organization: this.db.forOrganization(user.organizationId).getOrganization(), registrationEnabled: this.env.LOCKGUARD_ALLOW_REGISTRATION !== 'false' }; }
  signIn(req, res, user, expectedPasswordHash) {
    this.db.deleteSession(this.token(req));
    const token = this.db.createSession(user.id, expectedPasswordHash);
    this.setCookie(res, token);
    return this.response(user);
  }
  registerRoutes(router) {
    router.get('/api/v1/auth/session', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const user = this.authenticate(req);
      return res.json(user ? this.response(user) : { success: true, user: null, registrationEnabled: this.env.LOCKGUARD_ALLOW_REGISTRATION !== 'false' });
    });
    router.post('/api/v1/auth/register', async (req, res) => {
      this.validateMutation(req);
      if (this.env.LOCKGUARD_ALLOW_REGISTRATION === 'false') fail('Регистрация новых аккаунтов отключена.', 403);
      const email = emailAddress(req.body.email), password = passwordValue(req.body.password);
      const organizationName = req.body.organizationName;
      if (typeof organizationName !== 'string' || !organizationName.trim() || organizationName.trim().length > 100) fail('Название организации должно содержать от 1 до 100 символов.');
      this.limit(req, email);
      if (this.db.getUserByEmail(email)) fail('Не удалось создать аккаунт с этими данными. Используйте вход или другой email.', 409);
      const passwordHash = await hashPassword(password);
      let user;
      try { user = this.db.createAccount({ email, passwordHash, organizationName: organizationName.trim() }); }
      catch (error) {
        if (/UNIQUE constraint failed: users.email/.test(error.cause?.message || '')) fail('Не удалось создать аккаунт с этими данными.', 409);
        throw error;
      }
      return res.status(201).json(this.signIn(req, res, user));
    });
    router.post('/api/v1/auth/login', async (req, res) => {
      this.validateMutation(req);
      const email = emailAddress(req.body.email), password = passwordValue(req.body.password);
      this.limit(req, email);
      const record = this.db.getUserByEmail(email);
      const valid = await verifyPassword(password, record?.passwordHash || DUMMY);
      if (!record || !valid) fail('Неверный email или пароль.', 401);
      const { passwordHash, ...user } = record;
      return res.json(this.signIn(req, res, user, passwordHash));
    });
    router.post('/api/v1/auth/logout', async (req, res) => {
      this.validateMutation(req);
      this.db.deleteSession(this.token(req));
      this.setCookie(res, null);
      return res.json({ success: true });
    });
    router.post('/api/v1/auth/password', async (req, res) => {
      this.validateMutation(req);
      const user = this.authenticate(req);
      if (!user) fail('Войдите в аккаунт.', 401);
      this.limit(req, user.email);
      const current = passwordValue(req.body.currentPassword), next = passwordValue(req.body.password);
      const expected = this.db.getUserByEmail(user.email).passwordHash;
      if (!await verifyPassword(current, expected)) fail('Текущий пароль неверен.', 401);
      const nextHash = await hashPassword(next);
      this.db.changePassword(user.id, nextHash, expected);
      return res.json(this.signIn(req, res, user, nextHash));
    });
  }
}

module.exports = AuthService;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
