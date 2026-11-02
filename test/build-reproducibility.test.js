const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildI18n}=require('../scripts/build-i18n');
test('Translation assets and cache revisions are identical for Windows and Unix source line endings',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-build-eol-'));
  try{
    for(const dir of ['src/ui','docs'])fs.mkdirSync(path.join(root,dir),{recursive:true});
    const outputs=[];
    for(const eol of ['\n','\r\n']){
      for(const asset of ['i18n-catalog.js','i18n.js','i18n.css'])fs.writeFileSync(path.join(root,'src/ui',asset),['/* synthetic build fixture */','/* second line */',''].join(eol));
      for(const dir of ['src/ui','docs'])fs.writeFileSync(path.join(root,dir,'index.html'),'<html><head></head><body></body></html>');
      buildI18n(root);
      const output={};for(const asset of ['i18n-catalog.js','i18n.js','i18n.css','index.html'])output[asset]=fs.readFileSync(path.join(root,'docs',asset),'utf8');
      for(const asset of ['i18n-catalog.js','i18n.js','i18n.css'])assert.ok(!output[asset].includes('\r'));
      outputs.push(output);
      buildI18n(root);assert.equal(fs.readFileSync(path.join(root,'docs/index.html'),'utf8'),output['index.html'],'Rebuilding must be idempotent');
    }
    assert.deepEqual(outputs[0],outputs[1]);
  }finally{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^lockguard-build-eol-/);fs.rmSync(root,{recursive:true,force:true});}
});
