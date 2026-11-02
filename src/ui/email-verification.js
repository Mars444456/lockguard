/* Account email state is supplied by the server, never a local activation flag. */
window.LockGuardEmailVerification=class {
  constructor(app) {
    this.app=app;this.pending=false;this.notice='';
    this.host=document.createElement('section');this.host.className='email-verification';this.host.setAttribute('data-i18n-ignore','');
    this.title=document.createElement('h3');this.status=document.createElement('p');this.status.id='email-verification-status';this.status.setAttribute('role','status');
    this.send=document.createElement('button');this.send.id='btn-email-verification-send';this.send.type='button';this.send.className='btn-secondary';this.send.addEventListener('click',()=>this.request());
    this.check=document.createElement('button');this.check.id='btn-email-verification-refresh';this.check.type='button';this.check.className='btn-secondary';this.check.addEventListener('click',()=>this.refresh());
    this.host.append(this.title,this.status,this.send,this.check);document.getElementById('account-profile').appendChild(this.host);
    document.addEventListener('lockguard:language',()=>this.render());this.render();
  }
  t(ru,en){return window.LockGuardI18n?.locale?.startsWith('en')?en:ru;}
  render() {
    this.host.hidden=!this.app.account;if(!this.app.account)return;
    const verified=!!this.app.account.emailVerified;
    const notice=this.notice==='accepted'?this.t('Письмо передано почтовому сервису. Ссылка действует 30 минут. Откройте её, войдите в тот же аккаунт и подтвердите email.','The email was accepted by the mail service. The link expires in 30 minutes. Open it, sign in to the same account and confirm your email.'):(window.LockGuardI18n?.t?.(this.notice)||this.notice);
    this.title.textContent=this.t('Подтверждение email','Email verification');
    this.status.textContent=verified?this.t('Email подтверждён.','Email verified.'):
      notice||(!this.app.emailVerificationEnabled?this.t('Отправка писем пока не настроена. Анализ SQL доступен; создание и принятие приглашений требуют подтверждения email.','Email delivery is not configured. SQL analysis is available; creating and accepting invitations requires a verified email.'):
        this.t('Подтвердите владение почтой перед созданием и принятием приглашений.','Verify email ownership before creating or accepting invitations.'));
    this.send.hidden=verified;this.send.disabled=this.pending||!this.app.emailVerificationEnabled;
    this.send.textContent=this.pending?this.t('Отправляем…','Sending…'):this.t('Получить письмо подтверждения','Send verification email');
    this.check.hidden=verified;this.check.disabled=this.pending;this.check.textContent=this.t('Проверить подтверждение','Refresh verification status');
  }
  reset(){this.pending=false;this.notice='';this.host.hidden=true;this.status.textContent='';}
  async request() {
    if(this.pending)return;const epoch=this.app.identityVersion;this.pending=true;this.notice='';this.render();
    try {
      const response=await apiFetch('/api/v1/auth/email-verification/request',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),data=await response.json();
      if(epoch!==this.app.identityVersion)return;
      this.notice=data.alreadyVerified?'':'accepted';
      if(data.alreadyVerified)await this.refresh();
    }catch(error){if(epoch===this.app.identityVersion)this.notice=error.message;}
    finally{if(epoch===this.app.identityVersion){this.pending=false;this.render();}}
  }
  async refresh() {
    if(!this.app.account)return;const epoch=this.app.identityVersion,id=this.app.account.id;
    try {
      const response=await apiFetch('/api/v1/auth/session'),data=await response.json();
      if(epoch!==this.app.identityVersion||data.user?.id!==id)return;
      this.app.account={...this.app.account,emailVerified:data.user.emailVerified,emailVerifiedAt:data.user.emailVerifiedAt};
      this.app.emailVerificationEnabled=!!data.emailVerificationEnabled;this.app.showAccountState();this.app.workspace?.render();
    }catch(error){if(epoch===this.app.identityVersion)this.app.showToast(error.message);}
  }
};
