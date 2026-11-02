document.addEventListener('DOMContentLoaded',()=>{
  const profile=document.getElementById('account-profile');if(!profile)return;
  let epoch=0;
  const t=(ru,en)=>window.LockGuardI18n?.locale?.startsWith('en')?en:ru;
  const details=document.createElement('details'),summary=document.createElement('summary'),form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button'),result=document.createElement('p');
  details.setAttribute('data-i18n-ignore','');form.className='account-form';input.type='password';input.autocomplete='current-password';input.minLength=12;input.maxLength=128;input.required=true;button.type='submit';button.className='btn-secondary';result.setAttribute('role','status');result.style.overflowWrap='anywhere';
  const render=()=>{summary.textContent=t('Резервный код восстановления','Offline recovery code');label.textContent=t('Подтвердите текущий пароль','Confirm your current password');label.appendChild(input);button.textContent=t('Создать новый резервный код','Create a new recovery code');};
  render();details.appendChild(summary);details.appendChild(form);form.append(label,button,result);profile.appendChild(details);
  form.addEventListener('submit',async event=>{event.preventDefault();const identity=epoch;button.disabled=true;try{const response=await apiFetch('/api/v1/auth/recovery-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:input.value})}),data=await response.json();if(identity!==epoch)return;input.value='';result.textContent=t('Сохраните в менеджере паролей. Код показывается один раз, действует до ','Save in your password manager. This code is shown once and is valid until ')+data.recovery.expiresAt+'\n'+data.recovery.token;result.style.whiteSpace='pre-wrap';}catch(error){if(identity===epoch)result.textContent=error.message;}finally{button.disabled=false;}});
  window.LockGuardRecoveryReset=()=>{epoch++;form.reset();result.textContent='';};
  document.addEventListener('lockguard:language',render);document.addEventListener('lockguard:signed-out',()=>{form.reset();result.textContent='';});
});
