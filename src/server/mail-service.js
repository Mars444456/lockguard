// Fixed transactional provider. Recipient and link origin come from server state.
function origin(env) {
  try {
    const url=new URL(env.APP_URL);
    const localTest=env.NODE_ENV==='test'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!localTest)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;
    return url.origin;
  } catch {return null;}
}
function configured(env) {return !!(env.LOCKGUARD_MAIL_API_KEY&&env.LOCKGUARD_MAIL_FROM&&origin(env));}
async function sendMail(message,env,request=fetch) {
  if(!configured(env))throw Object.assign(new Error('Отправка писем не настроена.'),{statusCode:503,code:'MAIL_UNAVAILABLE'});
  try {
    const response=await request('https://api.resend.com/emails',{method:'POST',
      headers:{Authorization:'Bearer '+env.LOCKGUARD_MAIL_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({from:env.LOCKGUARD_MAIL_FROM,to:[message.to],subject:message.subject,text:message.text}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Provider rejected delivery');
  }catch{throw Object.assign(new Error('Письмо не удалось передать почтовому сервису. Повторите попытку позже.'),{statusCode:503,code:'MAIL_DELIVERY_FAILED'});}
}
module.exports={configured,origin,sendMail};
