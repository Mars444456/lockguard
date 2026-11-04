const {test,expect}=require('@playwright/test');
const url='http://127.0.0.1:3021/demo/?lang=en',key='lockguard.local-checks.v1';
const sql='CREATE INDEX local_history_ix ON local_history_orders(user_id);';
test('Public demo saves only on request, exports and imports inputs, then reanalyzes without a server',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const requests=[];
  await context.route(/^https?:/,route=>{const request=route.request();requests.push({url:request.url(),method:request.method()});return new URL(request.url()).hostname==='127.0.0.1'?route.continue():route.abort();});
  const page=await context.newPage();
  try{
    await page.goto(url);await page.locator('#local-project summary').click();await page.locator('#sql-input').fill(sql);
    await page.locator('#btn-analyze').click();await expect(page.locator('#res-max-lock')).toHaveText('SHARE');
    expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
    await page.getByLabel('Check name',{exact:true}).fill('<img src=x onerror=alert(1)>');
    await page.getByRole('button',{name:'Save check',exact:true}).click();await expect(page.locator('[data-local-checks]')).toContainText('<img src=x');
    await expect(page.locator('[data-local-checks] img')).toHaveCount(0);
    await page.reload();await page.locator('#local-project summary').click();await page.getByRole('button',{name:'Open and review',exact:true}).click();
    await expect(page.locator('#sql-input')).toHaveValue(sql);await expect(page.locator('#res-max-lock')).toHaveText('SHARE');
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export project',exact:true}).click();
    const artifact=await download,contents=await require('node:fs/promises').readFile(await artifact.path(),'utf8');
    const project=JSON.parse(contents);expect(project.draft.sql).toBe(sql);expect(project.checks).toHaveLength(1);expect(project.results).toBeUndefined();
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete history',exact:true}).click();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
    await page.locator('#sql-input').fill('SELECT 1;');
    await page.getByLabel('Open project file',{exact:true}).setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(contents)});
    await expect(page.locator('[data-import-preview]')).toBeVisible();await expect(page.locator('#sql-input')).toHaveValue('SELECT 1;');
    await page.getByRole('button',{name:'Import and replace SQL',exact:true}).click();
    await expect(page.locator('#sql-input')).toHaveValue(sql);await expect(page.locator('#res-max-lock')).toHaveText('SHARE');await expect(page.locator('[data-project-status]')).toContainText('current engine');
    await page.locator('[data-language="ru"]').click();await expect(page.getByRole('button',{name:'Сохранить проверку',exact:true})).toBeVisible();await expect(page.locator('#sql-input')).toHaveValue(sql);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    const before=await page.evaluate(key=>localStorage.getItem(key),key);
    await page.locator('[data-project-file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":999}')});
    await expect(page.locator('[data-project-status]')).toContainText('не поддерживается');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(before);
    expect(requests.filter(request=>request.method!=='GET'||new URL(request.url).pathname.includes('/api/'))).toEqual([]);
  }finally{await context.close();}
});

test('Unavailable browser storage preserves the editor and still allows project file export',async({browser})=>{
  const context=await browser.newContext();
  await context.route(/^https?:/,route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new Error('Blocked storage');}}));
  const page=await context.newPage();
  try{
    await page.goto(url);await page.locator('#local-project summary').click();await page.locator('#sql-input').fill(sql);
    await page.getByRole('button',{name:'Save check',exact:true}).click();await expect(page.locator('[data-project-status]')).toContainText('storage is unavailable');
    await expect(page.locator('#sql-input')).toHaveValue(sql);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export project',exact:true}).click();
    const artifact=await download,contents=await require('node:fs/promises').readFile(await artifact.path(),'utf8');
    const project=JSON.parse(contents);expect(project.draft.sql).toBe(sql);expect(project.checks).toEqual([]);
    await page.locator('#sql-input').fill('SELECT 1;');await page.getByLabel('Open project file',{exact:true}).setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(contents)});
    await page.getByRole('button',{name:'Import and replace SQL',exact:true}).click();
    await expect(page.locator('[data-project-status]')).toContainText('storage is unavailable');await expect(page.locator('#sql-input')).toHaveValue('SELECT 1;');
  }finally{await context.close();}
});
