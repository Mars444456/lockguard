/* Shared explanations for the browser-only demo and the server workspace. */
(() => {
  const text = (ru,en) => window.LockGuardI18n?.locale?.startsWith('en') ? en : ru;
  const node = (tag,value) => {const el=document.createElement(tag);el.textContent=value;return el;};
  window.LockGuardReview = {
    finding(card,finding,input) {
      const row=node('div','');row.className='review-evidence';row.setAttribute('data-i18n-ignore','');
      row.appendChild(node('span',finding.evidence?.source==='imported_schema_and_sql'
        ? text('SQL и снимок схемы · снимок не проверен на базе','SQL and schema snapshot · snapshot not verified against database')
        : text('Статическая проверка SQL · время ожидания неизвестно','Static SQL check · runtime waiting is unknown')));
      if(finding.rewrite==='unknown')row.appendChild(node('p',text('Перепись таблицы не подтверждена. Нужны исходный тип, выражение USING и версия PostgreSQL.','Heap rewrite is not established. Verify the source type, USING expression and PostgreSQL version.')));
      if(finding.line && input) {
        const button=node('button',text('К строке SQL','Go to SQL line')+' '+finding.line);button.type='button';button.className='btn-secondary btn-sm';
        button.addEventListener('click',()=>{const lines=input.value.split('\n');const start=lines.slice(0,finding.line-1).join('\n').length+(finding.line>1?1:0);input.focus();input.setSelectionRange(start,start+(lines[finding.line-1]?.length||0));input.scrollIntoView({block:'center',behavior:'smooth'});});
        row.appendChild(button);
      }
      card.appendChild(row);
    },
    manualSteps(container,plan) {
      for(const step of plan.manualSteps||[]) {
        const card=node('section','');card.className='violation-card review-manual';card.setAttribute('data-i18n-ignore','');
        card.appendChild(node('h4',step.ruleId+' · '+text('Требуется ручная проверка','Manual verification required')));
        card.appendChild(node('p',step.kind==='type_change_review'
          ? text('Перед сменой типа проверьте зависимости, ограничения, индексы, default и совместимость приложения. Автоматическая замена столбцов не подготовлена.','Before changing types, review dependencies, constraints, indexes, defaults and application compatibility. No automatic column swap is generated.')
          : text('Выполняйте по одному пакету. Проверьте оставшиеся NULL отдельно: SKIP LOCKED может пропустить занятые строки.','Run one batch at a time. Check remaining NULLs separately: SKIP LOCKED can skip busy rows.')));
        if(step.verificationSql)card.appendChild(node('pre',step.verificationSql));container.appendChild(card);
      }
    }
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const target=document.querySelector('.quick-access');if(!target)return;
    const note=node('p','');note.className='review-mode';note.setAttribute('data-i18n-ignore','');
    const render=()=>{note.textContent=window.LockGuard
      ? text('Локальный анализ в браузере: SQL не выполняется и не отправляется на сервер.','Local browser analysis: SQL is not executed or sent to a server.')
      : text('Кабинет: SQL отправляется вашему серверу LockGuard для анализа. Сохранённые проверки доступны участникам организации.','Workspace: SQL is sent to your LockGuard server for analysis. Saved checks are available to organization members.');};
    render();target.after(note);document.addEventListener('lockguard:language',render);
  });
})();
