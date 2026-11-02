const crypto=require('node:crypto');
const mail=require('./mail-service');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(message,statusCode=400,code)=>{throw Object.assign(new Error(message),{statusCode,code});};
class EmailVerificationService {
  constructor(db) {
    this.db=db;this.sql=db.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS email_verification_state(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,email TEXT NOT NULL,verified_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS email_verification_tokens(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,email TEXT NOT NULL,credential_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS email_verification_deliveries(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_attempt_at INTEGER NOT NULL);
    `);
  }
  configured(env) {return mail.configured(env);}
  state(userId) {
    const row=this.sql.prepare('SELECT v.verified_at FROM email_verification_state v JOIN users u ON u.id=v.user_id WHERE u.id=? AND v.email=u.email COLLATE NOCASE').get(userId);
    return {emailVerified:!!row,emailVerifiedAt:row?.verified_at||null};
  }
  requireVerified(userId) {
    if(!this.state(userId).emailVerified)fail('Подтвердите email в личном кабинете перед работой с приглашениями.',403,'EMAIL_VERIFICATION_REQUIRED');
  }
  issue(userId) {
    return this.db.transaction(()=>{
      const user=this.sql.prepare('SELECT email,password_hash FROM users WHERE id=?').get(userId);
      if(!user)fail('Войдите в аккаунт.',401);
      this.sql.prepare('DELETE FROM email_verification_tokens WHERE expires_at<=?').run(Date.now());
      const token=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+30*60000;
      this.sql.prepare('INSERT INTO email_verification_tokens VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,email=excluded.email,credential_hash=excluded.credential_hash,expires_at=excluded.expires_at')
        .run(userId,digest(token),user.email,digest(user.password_hash),expiresAt);
      return {token,expiresAt:new Date(expiresAt).toISOString(),email:user.email};
    });
  }
  consume(userId,token) {
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('Ссылка подтверждения недействительна или истекла.',400,'INVALID_VERIFICATION');
    return this.db.transaction(()=>{
      const row=this.sql.prepare('SELECT t.email,t.credential_hash,u.password_hash FROM email_verification_tokens t JOIN users u ON u.id=t.user_id WHERE t.user_id=? AND t.token_hash=? AND t.expires_at>? AND t.email=u.email COLLATE NOCASE').get(userId,digest(token),Date.now());
      if(!row||row.credential_hash!==digest(row.password_hash))fail('Ссылка подтверждения недействительна или истекла.',400,'INVALID_VERIFICATION');
      this.markVerified(userId,row.email);
      this.sql.prepare('DELETE FROM email_verification_tokens WHERE user_id=?').run(userId);
      return this.state(userId);
    });
  }
  markVerified(userId,email) {
    // Called only after a valid verification or email-recovery token was consumed.
    this.sql.prepare('INSERT INTO email_verification_state VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at').run(userId,email,new Date().toISOString());
  }
  async send(userId,env,request=fetch) {
    if(this.state(userId).emailVerified)return {...this.state(userId),alreadyVerified:true};
    if(!this.configured(env))fail('Подтверждение почты пока недоступно: отправка писем не настроена. SQL-анализ доступен, приглашения временно закрыты.',503,'MAIL_UNAVAILABLE');
    this.db.transaction(()=>{
      const last=this.sql.prepare('SELECT last_attempt_at FROM email_verification_deliveries WHERE user_id=?').get(userId)?.last_attempt_at;
      if(last&&Date.now()-last<60000)fail('Повторное письмо можно запросить через минуту.',429,'VERIFICATION_COOLDOWN');
      if(!this.db.allowAuthAttempt('email-verification:'+userId,10,86400000))fail('Лимит писем подтверждения достигнут. Повторите запрос завтра.',429,'VERIFICATION_LIMIT');
      this.sql.prepare('INSERT INTO email_verification_deliveries VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at').run(userId,Date.now());
    });
    const issued=this.issue(userId),link=new URL('/verify-email.html',mail.origin(env));link.hash='token='+issued.token;
    try {
      await mail.sendMail({to:issued.email,subject:'LockGuard: подтвердите email / verify your email',
        text:'Подтвердите этот email только если вы сами создали аккаунт LockGuard. Войдите в тот же аккаунт и нажмите кнопку подтверждения. Ссылка одноразовая и действует 30 минут. Не запрашивали письмо — проигнорируйте его.\nVerify only if you created this LockGuard account. Sign in to the same account and confirm. This one-use link expires in 30 minutes. Ignore unsolicited messages.\n\n'+link.href},env,request);
    } catch(error) {
      this.sql.prepare('DELETE FROM email_verification_tokens WHERE token_hash=?').run(digest(issued.token));throw error;
    }
    return {acceptedByProvider:true,expiresAt:issued.expiresAt,cooldownSeconds:60};
  }
}
module.exports=EmailVerificationService;
