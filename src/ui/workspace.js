/* Private organization collaboration. No public SQL sharing. */
window.LockGuardWorkspace = class {
  constructor(app) {
    this.app=app;this.epoch=0;this.members=[];this.reviews=[];this.current=null;
    this.host=document.createElement('section');this.host.className='workspace-review-panel';this.host.setAttribute('data-i18n-ignore','');
    document.getElementById('tab-runs').appendChild(this.host);
    document.addEventListener('lockguard:language',()=>{const draft=Array.from(this.host.querySelectorAll('input')).map(n=>({value:n.value,checked:n.checked}));this.render();Array.from(this.host.querySelectorAll('input')).forEach((n,i)=>{if(draft[i]){n.value=draft[i].value;n.checked=draft[i].checked;}});});this.reset();
  }
  t(ru,en) {return window.LockGuardI18n?.locale?.startsWith('en')?en:ru;}
  label(key) {const labels={owner:['Владелец','Owner'],editor:['Редактор','Editor'],reviewer:['Рецензент','Reviewer'],draft:['Черновик','Draft'],in_review:['На ревью','In review'],changes_requested:['Нужны изменения','Changes requested'],approved:['Согласовано','Approved'],created:['Создана карточка','Card created'],attest:['Подтверждение проверки','Verification attested'],assign:['Назначен ответственный','Assignee changed'],submit:['Отправлено на ревью','Submitted for review'],comment:['Комментарий','Comment'],approve:['Согласование','Approval'],request_changes:['Запрошены изменения','Changes requested'],waive:['Временное исключение','Temporary waiver']};return labels[key]?this.t(...labels[key]):key;}
  el(tag,text,parent) {const n=document.createElement(tag);if(text)n.textContent=text;if(parent)parent.appendChild(n);if(tag==='form')n.addEventListener('submit',e=>e.preventDefault());return n;}
  button(parent,title,action) {const b=this.el('button',title,parent);b.type='button';b.className='btn-secondary btn-sm';b.addEventListener('click',()=>this.perform(action));return b;}
  input(parent,label,type='text') {const l=this.el('label',label,parent),input=this.el('input','',l);input.type=type;return input;}
  options(parent,label,items,value) {const l=this.el('label',label,parent),select=this.el('select','',l);for(const item of items){const o=this.el('option',item.label,select);o.value=item.value;}if(value)select.value=value;return select;}
  async api(url,method='GET',body) {const r=await apiFetch(url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return r.json();}
  async perform(action) {try{await action();}catch(error){this.app.showToast(error.message);}}
  reset() {this.epoch++;this.members=[];this.invites=[];this.reviews=[];this.workspaces=[];this.current=null;this.operations=null;this.render();}
  async refresh() {
    if(!this.app.account)return;const epoch=this.epoch;
    const [team,reviews,workspaces,operations]=await Promise.all([this.api('/api/v1/team'),this.api('/api/v1/reviews'),this.api('/api/v1/workspaces'),this.app.account.role==='owner'?this.api('/api/v1/operations'):null]);
    if(epoch!==this.epoch)return;this.members=team.members;this.invites=team.invites||[];this.reviews=reviews.reviews;this.workspaces=workspaces.workspaces;this.operations=operations?.operations;this.render();
    const id=new URLSearchParams(window.location.search).get('review');if(id&&!this.current){await this.open(id);this.app.switchTab('runs');}
  }
  async switchTo(id) {
    const data=await this.api('/api/v1/workspaces/select','POST',{organizationId:id});
    this.app.resetPrivateData();this.app.account=data.user;this.app.emailVerificationEnabled=!!data.emailVerificationEnabled;this.app.showAccountState();await this.app.refreshPrivateData();
    this.app.accountChannel?.postMessage('changed');
  }
  async open(id) {const epoch=this.epoch,data=await this.api('/api/v1/reviews/'+encodeURIComponent(id));if(epoch!==this.epoch)return;this.current=data.review;this.render();}
  setRuns() {
    const select=this.host.querySelector('[data-review-run]');if(!select)return;const previous=select.value;
    const runs=(this.app.runs||[]).filter(r=>r.findingsVersion===1&&r.analysisComplete!==false&&r.coverageComplete===true);
    select.replaceChildren();for(const run of runs){const option=this.el('option',(run.filename||'SQL')+' · '+new Date(run.timestamp).toLocaleString(),select);option.value=run.id;}
    if(runs.some(r=>r.id===previous))select.value=previous;
  }
  async event(kind,extra={}) {const epoch=this.epoch,id=this.current.id,data=await this.api('/api/v1/reviews/'+encodeURIComponent(id)+'/events','POST',{kind,expectedRevision:this.current.revision,...extra});if(epoch!==this.epoch)return;this.current=data.review;await this.refresh();}
  render() {
    const h=this.host;h.replaceChildren();
    this.el('h2',this.t('Командное ревью миграций','Team migration review')+' · Pro',h);
    this.el('p',this.t('Карточки, SQL и обсуждения доступны только участникам выбранной организации. Согласование не заменяет проверку на базе.','Cards, SQL and discussions are visible only to members of the selected organization. Approval does not replace database verification.'),h);
    if(!this.app.account){this.el('p',this.t('Войдите, чтобы открыть рабочее пространство.','Sign in to open your workspace.'),h);return;}
    const pro=!!this.app.pro?.pro,role=this.app.account.role||'owner',editor=role!=='reviewer';
    const switcher=this.options(h,this.t('Организация','Organization'),(this.workspaces||[]).map(w=>({value:w.id,label:w.name+' · '+this.label(w.role)})),this.app.account.organizationId);
    switcher.addEventListener('change',()=>this.perform(()=>this.switchTo(switcher.value)));
    this.el('p',this.t('Ваша роль: ','Your role: ')+this.label(role),h);
    if(this.operations){
      const details=this.el('details','',h),ops=this.operations;
      this.el('summary',this.t('Сохранность данных','Data recovery readiness'),details);
      this.el('p',ops.storage==='temporary_demo'?this.t('Тестовый сервер: данные могут сброситься. Для рабочих данных нужно постоянное хранилище и внешняя резервная копия.','Temporary server: data can reset. Working data needs persistent storage and an off-host backup.'):this.t('Постоянное хранение: ','Persistent storage: ')+String(ops.persistentConfigured),details);
      const labels={ok:this.t('Копия проверена','Backup verified'),failed:this.t('Ошибка — проверьте хранилище и настройки копирования','Failed — check backup storage and configuration'),overdue:this.t('Копия устарела','Backup overdue'),never:this.t('Успешных копий пока нет','No successful backup yet'),unknown:this.t('Статус не подтверждён','Status unverified')};
      this.el('p',this.t('Резервное копирование: ','Backup status: ')+(labels[ops.backupStatus]||labels.unknown),details);
      this.el('p',this.t('Последняя попытка: ','Last attempt: ')+(ops.lastBackupAttemptAt||'—'),details);
      this.el('p',this.t('Последняя успешная копия: ','Last successful backup: ')+(ops.lastBackupAt||'—'),details);
      if(ops.backupStatus==='failed')this.el('p',this.t('Последний сбой: ','Last failure: ')+(ops.lastBackupFailureAt||'—'),details);
      this.el('p',this.t('Последняя проверка восстановления: ','Last restore drill: ')+(ops.lastRestoreVerifiedAt||'—'),details);
      this.el('p',this.t('Восстановление по email настроено: ','Email recovery configured: ')+String(ops.emailRecoveryConfigured),details);
    }
    const team=this.el('details','',h);this.el('summary',this.t('Участники и приглашения','Members and invitations'),team);
    for(const member of this.members) {const row=this.el('p',member.email+' · '+this.label(member.role),team);if(role==='owner'&&member.role!=='owner')this.button(row,this.t('Удалить участника','Remove member'),async()=>{if(window.confirm(this.t('Удалить участника из организации?','Remove this organization member?'))){await this.api('/api/v1/team/'+encodeURIComponent(member.id),'DELETE');await this.refresh();}});}
    for(const invite of this.invites||[]){const row=this.el('p',invite.email+' · '+this.label(invite.role)+' · '+new Date(invite.expiresAt).toLocaleString(),team);this.button(row,this.t('Отозвать приглашение','Revoke invitation'),async()=>{await this.api('/api/v1/team/invites/'+encodeURIComponent(invite.id),'DELETE');await this.refresh();});}
    if(!this.app.account.emailVerified)this.el('p',this.t('Подтвердите email в личном кабинете для создания и принятия приглашений.','Verify your email in account settings before creating or accepting invitations.'),team);
    if(role==='owner'&&pro&&this.app.account.emailVerified) {
      const form=this.el('form','',team),email=this.input(form,this.t('Email приглашённого','Invitee email'),'email');email.required=true;email.maxLength=254;
      const r=this.options(form,this.t('Роль','Role'),[{value:'reviewer',label:this.t('Рецензент: чтение и согласование','Reviewer: read and approve')},{value:'editor',label:this.t('Редактор: схемы и изменения','Editor: schemas and changes')}]);
      this.button(form,this.t('Создать приглашение','Create invitation'),async()=>{
        if(!form.reportValidity())return;const epoch=this.epoch,data=await this.api('/api/v1/team/invites','POST',{email:email.value,role:r.value});if(epoch!==this.epoch)return;
        form.reset();const box=this.input(form,this.t('Одноразовый код на 48 часов. Передайте лично; он работает только для указанного email.','One-use code valid for 48 hours. Share privately; it works only for the specified email.'));box.value=data.invite.token;box.readOnly=true;
      });
    }
    const accept=this.el('form','',team),token=this.input(accept,this.t('Код приглашения в другую организацию','Invitation code for another organization'));token.maxLength=64;token.autocomplete='off';
    this.button(accept,this.t('Принять приглашение','Accept invitation'),async()=>{const data=await this.api('/api/v1/team/accept','POST',{token:token.value.trim()});this.app.resetPrivateData();this.app.account=data.user;this.app.emailVerificationEnabled=!!data.emailVerificationEnabled;this.app.showAccountState();await this.app.refreshPrivateData();this.app.accountChannel?.postMessage('changed');}).disabled=!this.app.account.emailVerified;
    if(!pro)this.el('p',this.t('Создание и изменение ревью доступны в Pro. Существующие карточки можно читать и экспортировать.','Create and update reviews with Pro. Existing cards remain readable and exportable.'),h);
    if(pro&&editor) {
      const f=this.el('form','',h),title=this.input(f,this.t('Название изменения','Change title'));title.maxLength=120;title.required=true;
      const run=this.options(f,this.t('Сохранённая проверка','Saved check'),(this.app.runs||[]).filter(r=>r.findingsVersion===1&&r.analysisComplete!==false&&r.coverageComplete===true).map(r=>({value:r.id,label:(r.filename||'SQL')+' · '+new Date(r.timestamp).toLocaleString()})));
      run.setAttribute('data-review-run','');
      const source=this.input(f,this.t('Сохранить SQL из текущего редактора в закрытой карточке','Save SQL from the current editor in this private card'),'checkbox');
      this.button(f,this.t('Создать карточку ревью','Create review card'),async()=>{if(!f.reportValidity())return;const epoch=this.epoch,data=await this.api('/api/v1/reviews','POST',{title:title.value,runId:run.value,...(source.checked?{sql:document.getElementById('sql-input').value}:{})});if(epoch!==this.epoch)return;this.current=data.review;await this.refresh();});
    }
    const list=this.el('div','',h);list.className='review-card-list';
    for(const review of this.reviews)this.button(list,review.title+' · '+this.label(review.status),()=>this.open(review.id));
    if(this.current)this.detail(h,this.current,pro,role);
  }
  detail(parent,review,pro,role) {
    const card=this.el('article','',parent);card.className='private-review-card';this.el('h3',review.title,card);
    this.el('p',this.label(review.status)+' · '+this.t('редакция ','revision ')+review.revision,card);
    const expired=review.waivers.some(w=>Date.parse(w.expiresAt)<=Date.now());
    if(expired)this.el('p',this.t('Срок исключения истёк. Требуется повторная проверка.','A waiver has expired. Re-review is required.'),card);
    this.el('p','PostgreSQL '+(review.run.pgVersion||'—')+' · '+(review.run.filename||'SQL'),card);
    const meta=this.el('details','',card);this.el('summary',this.t('Версия SQL и снимок схемы','SQL version and schema snapshot'),meta);
    this.el('p','SQL SHA-256: '+(review.run.sqlHash||this.t('Повторите анализ для сохранения хеша','Re-run analysis to record a hash')),meta);
    this.el('p',this.t('Снимок схемы: ','Schema snapshot: ')+(review.run.schemaRevision||'—'),meta);
    if(review.sql){const details=this.el('details','',card);this.el('summary','SQL',details);this.el('pre',review.sql,details);}
    this.button(card,this.t('Скопировать закрытую ссылку','Copy private link'),async()=>{const url=new URL(window.location.href);url.searchParams.set('review',review.id);url.hash='tab-runs';await navigator.clipboard.writeText(url.href);this.app.showToast(this.t('Для открытия требуется вход участника организации.','Opening this link requires organization membership.'));});
    this.button(card,this.t('Экспорт карточки','Export card'),()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(review,null,2)],{type:'application/json'}));const a=this.el('a','');a.href=url;a.download='lockguard-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    if(role!=='reviewer'&&pro) {const select=this.options(card,this.t('Ответственный','Assignee'),[{value:'',label:'—'},...this.members.map(m=>({value:m.id,label:m.email}))],review.assigneeId);select.addEventListener('change',()=>this.perform(()=>this.event('assign',{assigneeId:select.value||null})));}
    const labels={schemaFresh:this.t('Снимок схемы актуален или контекст проверен вручную','Snapshot is current or context was verified manually'),backfillVerified:this.t('Backfill проверен или не требуется','Backfill verified or not applicable'),applicationCompatible:this.t('Совместимость приложения проверена','Application compatibility verified'),stagingVerified:this.t('Миграция проверена на тестовой базе','Migration verified in staging')};
    for(const [key,label] of Object.entries(labels)){const check=this.input(card,label,'checkbox');check.checked=!!review.checks[key];check.disabled=!pro||role==='reviewer';check.addEventListener('change',()=>this.perform(()=>this.event('attest',{check:key,value:check.checked})));}
    const findings=this.el('details','',card);this.el('summary',this.t('Замечания и исключения','Findings and waivers'),findings);
    for(const [index,finding] of review.run.findings.entries())this.el('p',`#${index+1} ${finding.ruleId} · ${finding.severity} · ${finding.table}`,findings);
    for(const waiver of review.waivers)this.el('p',`#${waiver.findingIndex+1}: ${waiver.reason} · ${waiver.expiresAt}`,findings);
    if(role==='owner'&&pro&&review.run.findings.length){const f=this.el('form','',findings),idx=this.input(f,this.t('Номер замечания','Finding number'),'number');idx.min=1;idx.max=review.run.findings.length;idx.value=1;const reason=this.input(f,this.t('Причина временного исключения','Temporary waiver reason'));reason.maxLength=2000;const expiry=this.input(f,this.t('Действует до','Valid until'),'date');this.button(f,this.t('Оформить исключение','Record waiver'),()=>this.event('waive',{findingIndex:Number(idx.value)-1,text:reason.value,expiresAt:expiry.value+'T23:59:59Z'}));}
    const comments=this.el('section','',card);this.el('h4',this.t('История решений','Decision history'),comments);
    for(const event of review.events){const extra=event.check?labels[event.check]+(event.value?' ✓':' —'):event.waiver?'#'+(event.waiver.findingIndex+1)+' · '+event.waiver.reason+' · '+event.waiver.expiresAt:event.kind==='assign'?this.members.find(m=>m.id===event.assigneeId)?.email||'—':'';this.el('p',`${event.revision} · ${this.label(event.kind)} · ${this.members.find(m=>m.id===event.actorId)?.email||this.t('Бывший участник','Former member')} · ${new Date(event.at).toLocaleString(window.LockGuardI18n?.locale||'ru-RU')}${extra?'\n'+extra:''}${event.text?'\n'+event.text:''}`,comments);}
    if(pro){const form=this.el('form','',card),message=this.input(form,this.t('Комментарий или основание решения','Comment or decision rationale'));message.maxLength=4000;
      this.button(form,this.t('Добавить комментарий','Add comment'),()=>this.event('comment',{text:message.value}));
      if(role!=='reviewer')this.button(form,this.t('Отправить на ревью','Submit for review'),()=>this.event('submit'));
      this.button(form,this.t('Запросить изменения','Request changes'),()=>this.event('request_changes',{text:message.value}));
      if(review.authorId!==this.app.account.id)this.button(form,this.t('Согласовать','Approve'),()=>this.event('approve',{text:message.value}));
    }
    if(role==='owner')this.button(card,this.t('Удалить карточку','Delete card'),async()=>{if(window.confirm(this.t('Удалить карточку и её историю?','Delete this card and its history?'))){await this.api('/api/v1/reviews/'+encodeURIComponent(review.id),'DELETE');this.current=null;await this.refresh();}});
  }
};
