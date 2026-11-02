const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
function page() {
  const {document,Event}=parseHTML('<html><body><section id="tab-runs"></section><textarea id="sql-input"></textarea></body></html>');
  Object.defineProperty(Object.getPrototypeOf(document.createElement('select')),'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.getAttribute('value')===value);}});
  const window={location:new URL('https://example.invalid/'),LockGuardI18n:{locale:'ru-RU'},confirm:()=>false};
  const member={id:'owner',email:'<img src=x onerror=alert(1)>@example.invalid',role:'owner'};
  const review={id:'review-one',title:'<script>private</script>',status:'draft',revision:1,authorId:'owner',assigneeId:null,sql:'<script>secret SQL</script>',run:{sqlHash:'abc',pgVersion:17,findings:[]},checks:{},waivers:[],events:[{kind:'comment',actorId:'owner',at:'2026-01-01',revision:1,text:'<img src=x>'}]};
  const app={account:{id:'owner',organizationId:'org-one',role:'owner',emailVerified:true},pro:{pro:true},runs:[],showToast(){},switchTab(){}};
  let deferred;
  const apiFetch=async url=>({json:async()=>{
    if(url==='/api/v1/team')return {members:[member]};if(url==='/api/v1/reviews')return {reviews:[review]};
    if(url==='/api/v1/workspaces')return {workspaces:[{id:'org-one',name:'<img src=x>',role:'owner'}]};if(url==='/api/v1/operations')return {operations:{storage:'temporary_demo'}};
    if(url.startsWith('/api/v1/reviews/'))return deferred?deferred():{review};throw new Error('Unexpected route');
  }});
  const scope={window,document,Event,URL,URLSearchParams,Blob,navigator:{clipboard:{writeText:async()=>{}}},setTimeout,apiFetch};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui/workspace.js'),'utf8'),scope);
  return {document,Event,window,app,review,workspace:new window.LockGuardWorkspace(app),delay:fn=>{deferred=fn;}};
}
test('Team review UI renders private content as text and switches languages without losing drafts',async()=>{
  const p=page();await p.workspace.refresh();await p.workspace.open(p.review.id);
  assert.equal(p.document.querySelectorAll('img,script').length,0);assert.match(p.document.body.textContent,/<script>secret SQL/);
  const input=p.document.querySelector('input');input.value='Unsaved draft';p.window.LockGuardI18n.locale='en-US';p.document.dispatchEvent(new p.Event('lockguard:language'));
  assert.match(p.document.body.textContent,/Team migration review/);assert.equal(p.document.querySelector('input').value,'Unsaved draft');
  p.app.account=null;p.workspace.reset();assert.doesNotMatch(p.document.body.textContent,/secret SQL|private<|onerror=alert/);
});
test('A delayed review response cannot restore private SQL after signing out',async()=>{
  const p=page();let resolve;let ready;const started=new Promise(r=>{ready=r;});p.delay(()=>new Promise(r=>{resolve=r;ready();}));const pending=p.workspace.open('review-one');await started;
  p.app.account=null;p.workspace.reset();resolve({review:p.review});await pending;
  assert.doesNotMatch(p.document.body.textContent,/secret SQL/);assert.equal(p.workspace.current,null);
});

test('New saved checks become selectable without clearing a draft review title',async()=>{
  const p=page();await p.workspace.refresh();
  const title=Array.from(p.document.querySelectorAll('label')).find(n=>n.textContent==='Название изменения').querySelector('input');title.value='Keep this draft';
  p.app.runs=[{id:'new-run',filename:'new-migration.sql',timestamp:'2026-01-01',findingsVersion:1,analysisComplete:true,coverageComplete:true}];p.workspace.setRuns();
  assert.equal(title.value,'Keep this draft');assert.equal(p.document.querySelector('[data-review-run] option').value,'new-run');
});
