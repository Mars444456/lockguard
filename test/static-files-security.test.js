require('./helpers/initialize');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-static-security-'));
process.env.LOCKGUARD_DB_FILE=path.join(runtime,'test.sqlite3');process.env.NODE_ENV='test';
const ui=path.resolve(__dirname,'../src/ui');
const sibling=fs.mkdtempSync(ui+'-security-');
const filename='private-marker.txt',marker='Synthetic private file outside the public UI';
fs.writeFileSync(path.join(sibling,filename),marker);
const alias=path.join(ui,path.basename(sibling)+'-link');
const server=require('../src/server/server'),db=require('../src/server/db');
const request=route=>new Promise((resolve,reject)=>{
  const req=http.get({hostname:'127.0.0.1',port:server.address().port,path:route},res=>{
    let body='';res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body}));
  });req.on('error',reject);
});
test.before(async()=>{
  fs.symlinkSync(sibling,alias,process.platform==='win32'?'junction':'dir');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
});
test.after(async()=>{
  if(server.listening)await new Promise(resolve=>server.close(resolve));db.close();
  if(fs.existsSync(alias)){
    assert.equal(path.dirname(path.resolve(alias)),ui);fs.unlinkSync(alias);
  }
  assert.equal(path.dirname(sibling),path.dirname(ui));assert.ok(path.basename(sibling).startsWith(path.basename(ui)+'-security-'));
  fs.rmSync(sibling,{recursive:true,force:true});
  assert.equal(path.dirname(runtime),path.resolve(os.tmpdir()));assert.match(path.basename(runtime),/^lockguard-static-security-/);
  fs.rmSync(runtime,{recursive:true,force:true});
});
test('A linked static directory cannot expose files outside the UI root',async()=>{
  const response=await request('/'+path.basename(alias)+'/'+filename);
  assert.equal(response.status,403);assert.equal(response.body.includes(marker),false);
});
test('A Windows absolute path cannot bypass a sibling directory boundary',{skip:process.platform!=='win32'},async()=>{
  const response=await request('/'+encodeURIComponent(path.join(sibling,filename)));
  assert.equal(response.status,403);assert.equal(response.body.includes(marker),false);
});
test('Normal public assets remain available',async()=>{
  const response=await request('/design.css');assert.equal(response.status,200);assert.match(response.body,/:root/);
});
test('A failed asset read does not expose its exception or stop the server',async t=>{
  const {PassThrough}=require('node:stream'),original=fs.createReadStream;
  const failure=t.mock.method(fs,'createReadStream',(...args)=>{
    if(args[0]!==fs.realpathSync(path.join(ui,'design.css')))return original(...args);
    const stream=new PassThrough();process.nextTick(()=>stream.destroy(new Error('private-path-and-token@example.invalid')));return stream;
  });
  try {
    const response=await request('/design.css');assert.equal(response.status,404);
    assert.doesNotMatch(response.body,/private-path-and-token|example\.invalid/);assert.equal(server.listening,true);
  } finally {failure.mock.restore();}
  assert.equal((await request('/design.css')).status,200);
});
