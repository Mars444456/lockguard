/* Explicit device-local SQL history. Only inputs are imported, never verdicts. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LockGuardLocalProject=api;})(typeof window==='undefined'?null:window,()=>{
  const KEY='lockguard.local-checks.v1',MAX_CHECKS=20,MAX_SQL=256*1024,MAX_FILE=2*1024*1024;
  const bytes=text=>new TextEncoder().encode(text).length;
  function fail(code){const error=new Error(code);error.code=code;throw error;}
  function input(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.sql!=='string'||bytes(value.sql)>MAX_SQL||!Number.isInteger(value.pgVersion)||value.pgVersion<10||value.pgVersion>18||typeof value.name!=='string'||value.name.length>80)fail('invalid');
    return {name:value.name,sql:value.sql,pgVersion:value.pgVersion};
  }
  function check(value){
    const clean=input(value);
    if(!clean.sql.trim()||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))fail('invalid');
    return {...clean,createdAt:new Date(value.createdAt).toISOString()};
  }
  function checks(values){if(!Array.isArray(values)||values.length>MAX_CHECKS)fail('limit');return values.map(check);}
  function project(value){
    if(!value||value.format!=='lockguard-project'||value.version!==1)fail('format');
    return {format:'lockguard-project',version:1,draft:input(value.draft),checks:checks(value.checks)};
  }
  function parse(text){
    if(typeof text!=='string'||bytes(text)>MAX_FILE)fail('size');
    let value;try{value=JSON.parse(text);}catch{fail('invalid');}return project(value);
  }
  function serialize(draft,history){
    const text=JSON.stringify(project({format:'lockguard-project',version:1,draft,checks:history}),null,2);
    if(bytes(text)>MAX_FILE)fail('size');return text;
  }
  class Store {
    constructor(storage){this.storage=storage;}
    read(){
      let raw;try{raw=this.storage.getItem(KEY);}catch{fail('storage');}if(raw===null)return [];
      try{if(bytes(raw)>MAX_FILE)fail('size');const value=JSON.parse(raw);if(value.version!==1)fail('format');return checks(value.checks);}catch{fail('corrupt');}
    }
    write(values){
      const clean=checks(values),raw=JSON.stringify({version:1,checks:clean});if(bytes(raw)>MAX_FILE)fail('size');
      try{this.storage.setItem(KEY,raw);}catch{fail('storage');}return clean;
    }
    save(draft){return this.write([check({...draft,createdAt:new Date().toISOString()}),...this.read()]);}
    remove(item){const values=this.read(),index=values.findIndex(value=>JSON.stringify(value)===JSON.stringify(item));if(index<0)fail('changed');values.splice(index,1);return this.write(values);}
    clear(){try{this.storage.removeItem(KEY);}catch{fail('storage');}}
    import(value){
      const incoming=project(value),existing=this.read(),known=new Set(existing.map(item=>JSON.stringify(item)));
      const added=incoming.checks.filter(item=>{const key=JSON.stringify(item);if(known.has(key))return false;known.add(key);return true;});
      this.write([...added,...existing]);return incoming.draft;
    }
  }
  function mount(app,host){
    if(!host)return;
    const t=(ru,en)=>window.LockGuardI18n?.language==='en'?en:ru;
    let storage;try{storage=window.localStorage;}catch{}
    const store=new Store(storage),name=host.querySelector('[data-project-name]'),list=host.querySelector('[data-local-checks]'),status=host.querySelector('[data-project-status]');
    const preview=host.querySelector('[data-import-preview]'),previewText=host.querySelector('[data-import-description]'),upload=host.querySelector('[data-project-file]');
    let pending=null,busy=false,importEpoch=0;
    const say=(ru,en)=>{status.textContent=t(ru,en);};
    const labels=[
      ['[data-local-project-title]','Проект на этом устройстве','Project on this device'],
      ['[data-project-name-label]','Название проверки','Check name'],
      ['[data-save-check]','Сохранить проверку','Save check'],
      ['[data-export-project]','Экспорт проекта','Export project'],
      ['[data-import-label]','Открыть файл проекта','Open project file'],
      ['[data-clear-history]','Удалить историю','Delete history'],
      ['[data-confirm-import]','Импортировать и заменить SQL','Import and replace SQL'],
      ['[data-cancel-import]','Отмена','Cancel'],
      ['[data-local-project-notice]','Сохраняйте проверки явно — до 20 записей в этом браузере. SQL не отправляется на сервер. История и файл проекта не зашифрованы; очистка данных сайта удалит историю. На общем компьютере не сохраняйте конфиденциальный SQL.','Save checks explicitly: up to 20 entries in this browser. SQL is not sent to a server. History and project files are not encrypted; clearing site data deletes history. Do not save confidential SQL on a shared computer.']
    ];
    const messages={
      storage:['Хранилище браузера недоступно или заполнено. История не изменена. Можно экспортировать текущий SQL в файл.','Browser storage is unavailable or full. History was not changed. You can export the current SQL to a file.'],
      corrupt:['История повреждена или имеет неподдерживаемый формат. Она не перезаписана. Можно удалить локальную историю и начать заново.','History is damaged or unsupported. It was not overwritten. You can delete local history and start again.'],
      size:['Слишком много данных. Максимум 256 КБ SQL на запись и 2 МБ на проект. Данные не изменены.','Too much data. Limits: 256 KB of SQL per entry and 2 MB per project. Data was not changed.'],
      limit:['Можно хранить до 20 проверок. Экспортируйте проект и удалите ненужные записи.','History holds up to 20 checks. Export your project and remove entries you no longer need.'],
      format:['Этот формат проекта не поддерживается. Данные не изменены.','This project format is unsupported. Data was not changed.'],
      invalid:['Файл или данные проекта некорректны. Данные не изменены.','The project file or data is invalid. Data was not changed.'],
      changed:['История изменилась в другой вкладке. Откройте её заново.','History changed in another tab. Open it again.']
    };
    const error=err=>say(...(messages[err.code]||messages.invalid));
    const draft=()=>({name:name.value.trim()||'migration.sql',sql:app.sqlInput.value,pgVersion:Number(app.versionSelect.value)});
    const setBusy=value=>{busy=value;for(const button of host.querySelectorAll('button'))button.disabled=value;upload.disabled=value;};
    function render(){
      for(const [selector,ru,en] of labels)host.querySelector(selector).textContent=t(ru,en);
      upload.setAttribute('aria-label',t('Открыть файл проекта','Open project file'));
      if(pending)previewText.textContent=t(`Добавится записей: ${pending.checks.length}. SQL в редакторе будет заменён. Результаты не импортируются — проверка выполнится заново.`,`Entries to add: ${pending.checks.length}. The editor SQL will be replaced. Results are not imported; SQL will be reviewed again.`);
      list.replaceChildren();let values;try{values=store.read();}catch(err){error(err);return;}
      if(!values.length){const p=document.createElement('li');p.textContent=t('Сохранённых проверок пока нет.','No saved checks yet.');list.appendChild(p);}
      values.forEach(item=>{
        const row=document.createElement('li'),title=document.createElement('p'),actions=document.createElement('div');
        title.textContent=`${item.name} · PostgreSQL ${item.pgVersion} · ${new Date(item.createdAt).toLocaleString(window.LockGuardI18n?.locale)}`;
        row.appendChild(title);row.appendChild(actions);
        for(const [label,action] of [[t('Открыть и проверить','Open and review'),()=>open(item)],[t('Удалить','Delete'),()=>{try{store.remove(item);say('Запись удалена из этого браузера.','Entry deleted from this browser.');render();}catch(err){error(err);render();}}]]){
          const button=document.createElement('button');button.type='button';button.className='btn-secondary btn-sm';button.textContent=label;button.addEventListener('click',action);actions.appendChild(button);
        }
        list.appendChild(row);
      });setBusy(busy);
    }
    function load(value){
      name.value=value.name;app.sqlInput.value=value.sql;app.versionSelect.value=String(value.pgVersion);app.showEmptyState();
      if(window.location.hash.startsWith('#sql=')){const url=new URL(window.location.href);url.hash='';window.history.replaceState(window.history.state,'',url.href);}
    }
    async function open(value){
      if(busy)return;setBusy(true);load(value);
      try{const result=await app.runAnalysis();if(result)say('SQL открыт и проверен текущим движком.','SQL opened and reviewed with the current engine.');else say('SQL открыт. Проверка не завершена; проверьте сообщение анализатора.','SQL opened. Analysis did not finish; check the analyzer message.');}
      finally{setBusy(false);}
    }
    host.querySelector('[data-save-check]').addEventListener('click',async()=>{
      if(busy)return;setBusy(true);
      try{
        const value=draft();input(value);if(!value.sql.trim()){say('Введите SQL перед сохранением.','Enter SQL before saving.');return;}
        const result=await app.runAnalysis();if(!result){say('Проверка не завершена. Для переноса текущего SQL используйте экспорт проекта.','Analysis did not finish. Use project export to transfer the current SQL.');return;}
        if(value.sql!==app.sqlInput.value||value.pgVersion!==Number(app.versionSelect.value)){say('SQL или версия изменились. Повторите сохранение.','SQL or version changed. Save again.');return;}
        store.save(value);say('Проверка сохранена только в этом браузере.','Check saved only in this browser.');render();
      }catch(err){error(err);}finally{setBusy(false);}
    });
    host.querySelector('[data-export-project]').addEventListener('click',()=>{
      try{
        let history=[];try{history=store.read();}catch{say('История недоступна: в файл войдёт только текущий SQL.','History is unavailable: the file will contain only the current SQL.');}
        const text=serialize(draft(),history),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');
        link.href=url;link.download='lockguard-project.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }catch(err){error(err);}
    });
    upload.addEventListener('change',async()=>{
      const epoch=++importEpoch,file=upload.files?.[0];upload.value='';pending=null;preview.hidden=true;if(!file)return;
      try{if(file.size>MAX_FILE)fail('size');const value=parse(await file.text());if(epoch!==importEpoch)return;pending=value;preview.hidden=false;render();}catch(err){if(epoch===importEpoch)error(err);}
    });
    host.querySelector('[data-confirm-import]').addEventListener('click',async()=>{
      if(!pending||busy)return;
      try{const value=store.import(pending);pending=null;preview.hidden=true;render();await open(value);}catch(err){error(err);}
    });
    host.querySelector('[data-cancel-import]').addEventListener('click',()=>{importEpoch++;pending=null;preview.hidden=true;});
    host.querySelector('[data-clear-history]').addEventListener('click',()=>{
      if(!window.confirm(t('Удалить всю локальную историю из этого браузера? При необходимости сначала экспортируйте проект.','Delete all local history from this browser? Export your project first if needed.')))return;
      try{store.clear();say('Локальная история удалена. SQL в редакторе сохранён.','Local history deleted. The editor SQL was kept.');render();}catch(err){error(err);}
    });
    document.addEventListener('lockguard:language',()=>{status.textContent='';render();});
    window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null)render();});
    render();return {store,render};
  }
  return {Store,mount,parse,serialize,KEY,MAX_CHECKS,MAX_SQL,MAX_FILE};
});
