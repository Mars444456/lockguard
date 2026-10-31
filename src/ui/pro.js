/* Organization-scoped Pro workflow. The server remains the authority for access. */
window.LockGuardPro = class {
  constructor(app) {
    this.app=app; this.profiles=[]; this.pro=false; this.epoch=0;
    const $=id=>document.getElementById(id);
    $('schema-form').addEventListener('submit',event=>{event.preventDefault();this.save();});
    $('schema-upload').addEventListener('change',async event=>{
      const file=event.target.files?.[0]; if(!file)return;
      if(file.size>512*1024) {this.message('Файл должен быть не больше 512 КБ.');return;}
      const epoch=this.epoch,source=await file.text();
      if(epoch===this.epoch)$('schema-source').value=source;
    });
    $('btn-schemas-refresh').addEventListener('click',()=>this.refresh());
    $('compare-form').addEventListener('submit',event=>{event.preventDefault();this.compare();});
    $('analysis-schema-select').addEventListener('change',()=>{
      $('schema-analysis-notice').hidden=true;
      this.app.invalidateAnalysis();
    });
    this.reset();
  }
  message(text) {document.getElementById('schema-message').textContent=text;}
  reset() {
    this.epoch++;this.pro=false;this.profiles=[];
    document.getElementById('schema-form').reset();
    document.getElementById('schema-list').replaceChildren();
    document.getElementById('comparison-result').replaceChildren();
    document.getElementById('compare-message').textContent='';
    document.getElementById('schema-analysis-notice').hidden=true;
    this.message('');this.setRuns([]);this.render();
  }
  selectedSchemaId() {return this.pro ? document.getElementById('analysis-schema-select').value : '';}
  render() {
    const $=id=>document.getElementById(id);
    $('schema-fields').disabled=!this.pro;
    $('btn-schema-save').disabled=!this.pro;
    $('pro-locked-note').hidden=this.pro;
    $('pro-active-note').hidden=!this.pro;
    $('btn-compare-runs').disabled=!this.pro || $('compare-before').options?.length<2;
    $('compare-pro-note').hidden=this.pro;
    const select=$('analysis-schema-select'),selected=select.value;
    select.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='Без сохранённой схемы';select.appendChild(empty);
    for(const profile of this.profiles) {
      const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name+' · '+profile.summary.tables+' табл.';select.appendChild(option);
    }
    select.disabled=!this.pro;select.value=this.pro && this.profiles.some(p=>p.id===selected) ? selected : '';
    $('schema-workspace-status').textContent=this.pro ? 'PRO · до 10 схем организации' : 'PRO · сохранённые схемы';
    const list=$('schema-list');list.replaceChildren();
    if(!this.profiles.length){const p=document.createElement('p');p.className='account-hint';p.textContent='Сохранённых схем пока нет.';list.appendChild(p);}
    for(const profile of this.profiles) {
      const card=document.createElement('article');card.className='schema-profile-card';
      const title=document.createElement('h3');title.textContent=profile.name;card.appendChild(title);
      const details=document.createElement('p');details.textContent=`PostgreSQL ${profile.summary.pgVersion} · таблиц: ${profile.summary.tables} · индексов: ${profile.summary.indexes} · ${profile.revision.slice(0,10)}`;card.appendChild(details);
      const actions=document.createElement('div');actions.className='schema-profile-actions';
      const exportButton=document.createElement('button');exportButton.className='btn-secondary btn-sm';exportButton.textContent='Экспорт JSON';exportButton.addEventListener('click',()=>this.export(profile.id));actions.appendChild(exportButton);
      const deleteButton=document.createElement('button');deleteButton.className='btn-secondary btn-sm';deleteButton.textContent='Удалить';deleteButton.addEventListener('click',()=>this.remove(profile.id));actions.appendChild(deleteButton);
      card.appendChild(actions);list.appendChild(card);
    }
  }
  async refresh() {
    if(!this.app.hasIdentity()){this.reset();return;}
    const epoch=this.epoch;
    try {
      const response=await apiFetch('/api/v1/schemas'),data=await response.json();
      if(epoch!==this.epoch)return;
      this.profiles=data.schemas;this.pro=!!data.features?.pro;this.render();
      this.setRuns(this.app.runs||[]);
    } catch(error) {if(epoch===this.epoch)this.message(error.message);}
  }
  async save() {
    const $=id=>document.getElementById(id),epoch=this.epoch,button=$('btn-schema-save');button.disabled=true;this.message('Проверяем структуру…');
    try {
      const source=$('schema-source').value.trim().replace(/^\uFEFF/,'');
      const payload={name:$('schema-name').value.trim(),pgVersion:Number($('schema-pg-version').value),defaultSchema:$('schema-default').value.trim()||'public',
        ...(/^\s*\{/.test(source) ? {schema:JSON.parse(source)} : {sql:source})};
      const response=await apiFetch('/api/v1/schemas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const data=await response.json();if(epoch!==this.epoch)return;
      $('schema-source').value='';$('schema-upload').value='';await this.refresh();
      if(epoch!==this.epoch)return;
      $('analysis-schema-select').value=data.profile.id;
      this.app.invalidateAnalysis();
      this.message('Схема сохранена и выбрана для анализа. Исходный SQL схемы не выполнялся и не сохранялся.');
    } catch(error){if(epoch===this.epoch)this.message(error.message);}
    finally{button.disabled=!this.pro;}
  }
  async export(id) {
    const epoch=this.epoch;
    try {
      const response=await apiFetch('/api/v1/schemas/'+encodeURIComponent(id)),data=await response.json();if(epoch!==this.epoch)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(data.profile.schema,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='lockguard-schema.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error){if(epoch===this.epoch)this.message(error.message);}
  }
  async remove(id) {
    if(!window.confirm('Удалить сохранённую схему? Результаты прежних проверок останутся в истории.'))return;
    const epoch=this.epoch;
    try {await apiFetch('/api/v1/schemas/'+encodeURIComponent(id),{method:'DELETE'});if(epoch===this.epoch)await this.refresh();}
    catch(error){if(epoch===this.epoch)this.message(error.message);}
  }
  renderContext(result) {
    const notice=document.getElementById('schema-analysis-notice');notice.hidden=!result.schemaProfile;
    notice.textContent=result.schemaProfile ? `Схема: ${result.schemaProfile.name} · ${result.schemaProfile.revision.slice(0,10)}. Анализ учитывает импортированную структуру. Снимок не сверяется с работающей базой и не измеряет длительность блокировок.` : '';
  }
  setRuns(runs) {
    const eligible=runs.filter(run=>run.findingsVersion===1 && run.analysisComplete!==false);
    for(const id of ['compare-before','compare-after']) {
      const select=document.getElementById(id),previous=select.value;select.replaceChildren();
      for(const run of eligible) {const option=document.createElement('option');option.value=run.id;option.textContent=`${new Date(run.timestamp).toLocaleString('ru-RU')} · ${run.filename||'SQL'} · ${run.violationsCount} замеч.`;select.appendChild(option);}
      select.value=eligible.some(run=>run.id===previous)?previous:eligible[id==='compare-before'?1:0]?.id||'';
    }
    document.getElementById('btn-compare-runs').disabled=!this.pro || eligible.length<2;
  }
  async compare() {
    const epoch=this.epoch,$=id=>document.getElementById(id),button=$('btn-compare-runs');button.disabled=true;$('compare-message').textContent='Сравниваем замечания…';
    try {
      const response=await apiFetch('/api/v1/runs/compare?before='+encodeURIComponent($('compare-before').value)+'&after='+encodeURIComponent($('compare-after').value));
      const {comparison}=await response.json();if(epoch!==this.epoch)return;
      const target=$('comparison-result');target.replaceChildren();
      for(const [key,title] of [['resolved','Устранены'],['introduced','Новые'],['persisting','Остались']]) {
        const card=document.createElement('section');card.className='comparison-column '+key;
        const h=document.createElement('h3');h.textContent=title+' · '+comparison[key].length;card.appendChild(h);
        for(const finding of comparison[key]){const p=document.createElement('p');p.textContent=`${finding.ruleId} · ${window.LockGuardLabels?.titles[finding.ruleId]||finding.ruleName} · ${finding.table} · строка ${finding.line}`;card.appendChild(p);}
        target.appendChild(card);
      }
      $('compare-message').textContent=(comparison.contextChanged?'Снимки схем различаются. Это могло изменить результат. ':'')+(comparison.differentFiles?'Выбраны разные файлы. ':'')+'Сопоставление учитывает правило, объект и уровень риска. Отсутствие замечаний не гарантирует безопасный релиз.';
    } catch(error){if(epoch===this.epoch)$('compare-message').textContent=error.message;}
    finally{button.disabled=!this.pro;}
  }
};
