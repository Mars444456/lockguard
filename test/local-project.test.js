const test=require('node:test'),assert=require('node:assert/strict');
const {Store,parse,serialize,KEY,MAX_SQL,MAX_FILE}=require('../src/ui/local-project');
const draft={name:'Migration <img src=x>',sql:'-- keep whitespace\nCREATE INDEX ix ON orders(user_id);\n',pgVersion:17};
function memory(){const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}

test('Explicit saves persist exact SQL and version; clearing history leaves unrelated browser settings',()=>{
  const storage=memory(),store=new Store(storage);storage.setItem('lockguard.language','en');
  assert.deepEqual(store.read(),[]);assert.equal(storage.getItem(KEY),null);
  store.save(draft);const restored=new Store(storage).read();assert.equal(restored.length,1);assert.equal(restored[0].sql,draft.sql);assert.equal(restored[0].pgVersion,17);
  store.clear();assert.equal(storage.getItem(KEY),null);assert.equal(storage.getItem('lockguard.language'),'en');
});
test('Project round trips transfer inputs, merge without duplicates, and discard forged verdicts',()=>{
  const source=new Store(memory());source.save(draft);
  const value=JSON.parse(serialize({...draft,sql:'SELECT 2;'},source.read()));value.results={passed:true};value.checks[0].verdict='SAFE';value.draft.__proto__={pro:true};
  const imported=parse(JSON.stringify(value)),target=new Store(memory());assert.equal(imported.results,undefined);assert.equal(imported.checks[0].verdict,undefined);assert.equal(imported.draft.pro,undefined);
  assert.equal(target.import(imported).sql,'SELECT 2;');target.import(imported);assert.equal(target.read().length,1);assert.equal(target.read()[0].sql,draft.sql);
});
test('Invalid project contents and unsupported versions cannot modify existing history',()=>{
  const storage=memory(),store=new Store(storage);store.save(draft);const before=storage.getItem(KEY);
  const good=JSON.parse(serialize(draft,store.read()));
  for(const mutation of [value=>value.version=2,value=>value.format='other',value=>value.draft.pgVersion=19,value=>value.draft.pgVersion=true,value=>value.checks[0].createdAt='invalid',value=>value.checks[0].sql='',value=>value.draft.name='x'.repeat(81),value=>value.checks={}]){
    const value=structuredClone(good);mutation(value);assert.throws(()=>store.import(value));assert.equal(storage.getItem(KEY),before);
  }
  assert.throws(()=>parse('{invalid'));assert.throws(()=>parse('x'.repeat(MAX_FILE+1)));
  assert.throws(()=>serialize({...draft,sql:'x'.repeat(MAX_SQL+1)},[]));
});
test('History bounds and quota failures preserve the previous data instead of pruning it',()=>{
  const storage=memory(),store=new Store(storage);for(let i=0;i<20;i++)store.save({...draft,name:String(i)});
  const before=storage.getItem(KEY);assert.throws(()=>store.save(draft),{code:'limit'});assert.equal(storage.getItem(KEY),before);
  storage.setItem=()=>{throw new Error('private browser exception');};
  assert.throws(()=>store.remove(store.read()[0]),{code:'storage'});assert.equal(storage.getItem(KEY),before);
  assert.throws(()=>new Store(undefined).read(),{code:'storage'});
});
test('Corrupt storage is never overwritten by save or import; explicit deletion can reset it',()=>{
  const storage=memory(),store=new Store(storage);storage.setItem(KEY,'invalid SQL-sensitive data');
  assert.throws(()=>store.save(draft),{code:'corrupt'});assert.equal(storage.getItem(KEY),'invalid SQL-sensitive data');
  assert.throws(()=>store.import(parse(serialize(draft,[]))),{code:'corrupt'});store.clear();store.save(draft);assert.equal(store.read().length,1);
});
test('Deleting a stale entry cannot delete a different record changed by another tab',()=>{
  const store=new Store(memory());store.save(draft);const stale=store.read()[0];store.clear();store.save({...draft,name:'Other'});
  assert.throws(()=>store.remove(stale),{code:'changed'});assert.equal(store.read()[0].name,'Other');
});
