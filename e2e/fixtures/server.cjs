// Disposable browser-test infrastructure. This entry point is not a product route
// or a production mail fallback; all controls live on a separate loopback server.
if(process.env.LOCKGUARD_E2E_RUN!=='1')throw new Error('Run via npm run test:browser in the isolated test workflow.');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-browser-'));
const {previewSettings}=require(path.join(root,'scripts/preview-server'));
const env=previewSettings('https://example.invalid',runtime,3020);
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,env,{NODE_ENV:'test',APP_URL:'http://127.0.0.1:3020',LOCKGUARD_MAIL_FROM:'LockGuard <mail@example.invalid>',LOCKGUARD_MAIL_API_KEY:'isolated-test-provider'});
process.chdir(runtime);
const inbox=[];
global.fetch=async(address,options)=>{
  if(address!=='https://api.resend.com/emails')throw new Error('External requests are disabled in browser tests.');
  const message=JSON.parse(options.body);
  if(message.to.length!==1||!message.to[0].endsWith('@example.invalid'))throw new Error('Test mail must use reserved example.invalid addresses.');
  inbox.push(message);return new Response('{"id":"local-test-message"}');
};
const db=require(path.join(root,'src/server/db')),app=require(path.join(root,'src/server/server'));
const controls=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  try {
    const url=new URL(req.url,'http://127.0.0.1:3021');
    if(req.method==='GET'&&url.pathname==='/ready'){res.end('{}');return;}
    if(req.method==='GET'&&url.pathname==='/inbox'){
      const email=url.searchParams.get('email');if(!email?.endsWith('@example.invalid'))throw new Error('Invalid test address');
      res.end(JSON.stringify(inbox.filter(message=>message.to[0]===email)));return;
    }
    if(req.method==='POST'&&['/grant-pro','/expire-pro'].includes(url.pathname)){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw new Error('Test control payload too large');}
      const email=JSON.parse(body).email;if(!email?.endsWith('@example.invalid'))throw new Error('Invalid test address');
      const user=db.getUserByEmail(email);if(!user)throw new Error('Test account does not exist');
      const store=db.forOrganization(user.organizationId);
      if(url.pathname==='/expire-pro')store.updateOrganization({accessUntil:new Date(0).toISOString()});
      else store.updatePlan('team');
      res.end('{}');return;
    }
    res.writeHead(404);res.end('{}');
  }catch{res.writeHead(400);res.end('{"error":"Invalid test control request"}');}
});
app.listen(3020,'127.0.0.1');controls.listen(3021,'127.0.0.1');
const stop=()=>{controls.close();app.close(()=>{db.close();const resolved=path.resolve(runtime);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('lockguard-browser-'))throw new Error('Invalid test runtime');fs.rmSync(resolved,{recursive:true,force:true});process.exit(0);});app.closeIdleConnections();controls.closeIdleConnections();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
