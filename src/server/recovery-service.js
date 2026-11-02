const crypto=require('node:crypto');
const mail=require('./mail-service');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const invalid=()=>{throw Object.assign(new Error('Код восстановления недействителен или истёк.'),{statusCode:401});};
class RecoveryService {
  constructor(db) {
    this.db=db;
    db.sql.exec("CREATE TABLE IF NOT EXISTS recovery_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('offline','email')),expires_at INTEGER NOT NULL,UNIQUE(user_id,kind))");
  }
  issue(userId,kind='offline') {
    if(!['offline','email'].includes(kind))throw new Error('Unknown recovery type');
    const token=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+(kind==='email'?30*60000:365*86400000);
    this.db.sql.prepare('INSERT INTO recovery_tokens VALUES(?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at').run(digest(token),userId,kind,expiresAt);
    return {token,expiresAt:new Date(expiresAt).toISOString()};
  }
  verify(email,token) {
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))invalid();
    const row=this.db.sql.prepare('SELECT u.id,u.password_hash AS passwordHash,r.kind FROM recovery_tokens r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>? AND u.email=? COLLATE NOCASE').get(digest(token),Date.now(),email);
    if(!row)invalid();return row;
  }
  consume(email,token,passwordHash,expectedHash) {
    this.db.transaction(()=>{
      const user=this.verify(email,token);if(user.passwordHash!==expectedHash)invalid();
      this.db.changePassword(user.id,passwordHash,expectedHash);
      if(user.kind==='email')this.db.emailVerification.markVerified(user.id,email);
      this.db.sql.prepare('DELETE FROM recovery_tokens WHERE user_id=?').run(user.id);
    });
  }
  configured(env) {return mail.configured(env);}
  async send(email,env,request=fetch) {
    if(!this.configured(env))throw Object.assign(new Error('Почтовое восстановление пока не настроено. Используйте сохранённый резервный код.'),{statusCode:503});
    const user=this.db.getUserByEmail(email);
    if(!user)return;
    const recovery=this.issue(user.id,'email'),link=new URL('/reset.html',env.APP_URL);link.hash='token='+recovery.token;
    try {
      const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.LOCKGUARD_MAIL_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({from:env.LOCKGUARD_MAIL_FROM,to:[email],subject:'LockGuard: восстановление доступа / password reset',
          text:'Ссылка действует 30 минут и только один раз. Если вы не запрашивали восстановление, проигнорируйте письмо.\nThis one-use link expires in 30 minutes. Ignore this email if you did not request it.\n\n'+link.href}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('Delivery rejected');
    } catch {
      this.db.sql.prepare('DELETE FROM recovery_tokens WHERE token_hash=?').run(digest(recovery.token));
      // Do not expose recipient existence or provider details to an unauthenticated caller.
      console.error('LockGuard recovery delivery failed. Check the configured mail provider.');
    }
  }
}
module.exports={RecoveryService};
