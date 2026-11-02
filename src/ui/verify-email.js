(()=>{
  let token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
  history.replaceState(null,'',location.pathname+location.search);
  let language=new URLSearchParams(location.search).get('lang')==='en'?'en':'ru',user=null,pending=false,done=false,message='';
  const $=id=>document.getElementById(id),t=(ru,en)=>language==='en'?en:ru;
  const valid=()=>/^[a-f0-9]{64}$/.test(token);
  function render(){
    const messages={session_error:t('Не удалось проверить вход. Повторите попытку.','Could not check sign-in. Please retry.'),sign_in:t('Войдите в тот же аккаунт и повторите проверку входа.','Sign in to the same account and refresh sign-in.'),invalid:t('Ссылка недействительна, истекла или относится к другому аккаунту. Запросите новую в личном кабинете.','This link is invalid, expired or belongs to another account. Request a new one from your account.'),request_error:t('Не удалось подтвердить email. Повторите попытку.','Could not verify your email. Please retry.')};
    document.documentElement.lang=language;$('verify-language').textContent=language==='ru'?'English':'Русский';
    $('verify-title').textContent=t('Подтверждение email','Verify your email');
    $('verify-note').textContent=t('Подтверждайте адрес только для аккаунта, который вы создали сами. Ссылка одноразовая и действует 30 минут.','Only verify an account you created yourself. This one-use link expires in 30 minutes.');
    $('verify-login').textContent=t('Войти в аккаунт в новой вкладке','Sign in in a new tab');$('verify-login').href='/?lang='+language+'#account';$('verify-login').hidden=!!user;
    $('verify-account').textContent=user?user.email:t('Для подтверждения войдите в тот же аккаунт. Эта вкладка сохранит ссылку до закрытия.','Sign in to the same account to confirm. This tab keeps the link until it is closed.');
    $('verify-check-session').textContent=t('Проверить вход','Refresh sign-in');$('verify-check-session').disabled=pending;
    $('verify-confirm').textContent=pending?t('Проверяем…','Checking…'):t('Подтвердить email','Verify email');$('verify-confirm').disabled=pending||!user||!valid()||done;
    $('verify-message').textContent=done?t('Email подтверждён. Можно вернуться в кабинет.','Email verified. You can return to your account.'):!valid()?t('В ссылке нет действительного кода. Запросите новое письмо в личном кабинете.','The link has no valid code. Request a new email from your account.'):messages[message]||'';
    $('verify-new-link').textContent=t('Если ссылка устарела, запросите новую в личном кабинете.','If the link expired, request a new one from your account.');
  }
  async function session(){
    pending=true;render();try{const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();user=data.user;done=!!user?.emailVerified;}
    catch{message='session_error';}finally{pending=false;render();}
  }
  $('verify-language').addEventListener('click',()=>{language=language==='ru'?'en':'ru';render();});
  $('verify-check-session').addEventListener('click',session);
  $('verify-confirm').addEventListener('click',async()=>{
    if(pending||!user||!valid()||done)return;pending=true;message='';render();
    try{
      const response=await fetch('/api/v1/auth/email-verification/confirm',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
      const data=await response.json();
      if(!response.ok){message=response.status===401?'sign_in':'invalid';if(response.status===401)user=null;return;}
      done=!!data.user?.emailVerified;if(!done)throw new Error();token='';
      if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('lockguard-account');channel.postMessage('email-verified');channel.close();}
    }catch{message='request_error';}
    finally{pending=false;render();}
  });
  render();session();
})();
