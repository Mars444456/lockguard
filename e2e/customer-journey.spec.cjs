const {test,expect}=require('@playwright/test');
const password='Isolated browser account password 2026';
const controls='http://127.0.0.1:3021';
async function isolatedContext(browser){const context=await browser.newContext();await context.route(/^https?:/,route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());return context;}
async function register(page,email,name){
  await page.goto('/?lang=ru');await page.getByRole('button',{name:'Регистрация',exact:true}).first().click();
  await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);
  await page.getByLabel('Название организации',{exact:true}).first().fill(name);
  await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
  await expect(page.locator('#account-profile-email')).toHaveText(email);
}
async function proofLink(page,email,request){
  await page.getByRole('button',{name:'Получить письмо подтверждения',exact:true}).click();
  await expect(page.locator('#email-verification-status')).toContainText('Письмо передано');
  const response=await request.get(controls+'/inbox?email='+encodeURIComponent(email));
  const messages=await response.json();expect(messages).toHaveLength(1);
  return messages[0].text.match(/http:\/\/\S+/)[0];
}
async function verify(page,email,request){
  const link=await proofLink(page,email,request),confirmation=await page.context().newPage();await confirmation.goto(link);
  await expect(confirmation).not.toHaveURL(/token=/);await expect(confirmation.getByRole('button',{name:'Подтвердить email',exact:true})).toBeEnabled();
  await confirmation.getByRole('button',{name:'Подтвердить email',exact:true}).click();await expect(confirmation.getByRole('status')).toContainText('Email подтверждён');await confirmation.close();
  await expect(page.locator('#email-verification-status')).toHaveText('Email подтверждён.');
}
test('Verified owner and reviewer complete a schema-aware migration review without cross-organization access',async({browser,request})=>{
  const ownerContext=await isolatedContext(browser),reviewerContext=await isolatedContext(browser);
  const owner=await ownerContext.newPage(),reviewer=await reviewerContext.newPage();
  const ownerEmail='journey-owner@example.invalid',reviewerEmail='journey-reviewer@example.invalid';
  try{
    await register(owner,ownerEmail,'Browser owner');
    await owner.getByRole('textbox',{name:'SQL-миграция PostgreSQL'}).fill("SET lock_timeout='3s'; CREATE INDEX CONCURRENTLY ix ON customers(id);");
    await verify(owner,ownerEmail,request);
    await expect(owner.getByRole('textbox',{name:'SQL-миграция PostgreSQL'})).toHaveValue(/CREATE INDEX CONCURRENTLY/);
    await register(reviewer,reviewerEmail,'Browser reviewer');await verify(reviewer,reviewerEmail,request);
    expect((await request.post(controls+'/grant-pro',{data:{email:ownerEmail}})).ok()).toBeTruthy();
    await owner.reload();await owner.getByRole('button',{name:'Схемы PRO',exact:false}).click();
    await owner.getByLabel('Название снимка',{exact:true}).fill('Browser schema');
    await owner.getByLabel('Структура схемы',{exact:true}).fill('CREATE TABLE customers(id int,name varchar(100));');
    await owner.locator('#btn-schema-save').click();await expect(owner.locator('#schema-list')).toContainText('Browser schema');
    await owner.getByRole('button',{name:'SQL-проверка',exact:true}).click();
    const select=owner.locator('#analysis-schema-select');await select.selectOption({label:'Browser schema · 1 табл.'});
    await owner.getByRole('textbox',{name:'SQL-миграция PostgreSQL'}).fill("SET lock_timeout='3s'; ALTER TABLE customers ADD COLUMN bio text;");
    await owner.getByRole('button',{name:'Проверить SQL',exact:true}).click();await expect(owner.locator('#verdict-badge')).toHaveText('Нарушений правил нет');
    expect((await(await reviewer.request.get('/api/v1/runs')).json()).runs).toEqual([]);
    await owner.getByRole('button',{name:'История проверок',exact:true}).click();
    const team=owner.getByText('Участники и приглашения',{exact:true});await team.click();
    await owner.getByLabel('Email приглашённого',{exact:true}).fill(reviewerEmail);await owner.getByRole('button',{name:'Создать приглашение',exact:true}).click();
    const invitation=await owner.getByLabel('Одноразовый код на 48 часов. Передайте лично; он работает только для указанного email.',{exact:true}).inputValue();
    await reviewer.getByRole('button',{name:'История проверок',exact:true}).click();await reviewer.getByText('Участники и приглашения',{exact:true}).click();
    await reviewer.getByLabel('Код приглашения в другую организацию',{exact:true}).fill(invitation);await reviewer.getByRole('button',{name:'Принять приглашение',exact:true}).click();
    await expect(reviewer.locator('#org-name')).toHaveText('Browser owner');
    await owner.getByLabel('Название изменения',{exact:true}).fill('Browser migration review');await owner.getByRole('button',{name:'Создать карточку ревью',exact:true}).click();
    await expect(owner.locator('.private-review-card')).toContainText('Browser migration review');
    for(const [index,label] of ['Снимок схемы актуален или контекст проверен вручную','Backfill проверен или не требуется','Совместимость приложения проверена','Миграция проверена на тестовой базе'].entries()){
      const response=owner.waitForResponse(r=>r.url().includes('/events')&&r.request().method()==='POST');
      await owner.getByLabel(label,{exact:true}).check();expect((await response).ok()).toBeTruthy();await expect(owner.getByLabel(label,{exact:true})).toBeChecked();
      await expect(owner.locator('.private-review-card')).toContainText('редакция '+(index+2));
    }
    await owner.getByRole('button',{name:'Отправить на ревью',exact:true}).click();await expect(owner.locator('.private-review-card')).toContainText('На ревью');
    await reviewer.reload();await reviewer.getByRole('button',{name:'История проверок',exact:true}).click();
    await reviewer.getByRole('button',{name:'Browser migration review · На ревью',exact:true}).click();
    await reviewer.getByLabel('Комментарий или основание решения',{exact:true}).fill('Checked independently in isolated staging.');
    await reviewer.getByRole('button',{name:'Согласовать',exact:true}).click();await expect(reviewer.locator('.private-review-card')).toContainText('Согласовано');
  }finally{await ownerContext.close();await reviewerContext.close();}
});

test('A verification link is inert on GET and cannot confirm a different signed-in account',async({browser,request})=>{
  const a=await isolatedContext(browser),b=await isolatedContext(browser),pa=await a.newPage(),pb=await b.newPage();
  try{
    await register(pa,'journey-link-owner@example.invalid','Link owner');const link=await proofLink(pa,'journey-link-owner@example.invalid',request);
    await register(pb,'journey-link-other@example.invalid','Other account');await pb.goto(link);
    await expect(pb).not.toHaveURL(/token=/);await pb.getByRole('button',{name:'Подтвердить email',exact:true}).click();
    await expect(pb.getByRole('status')).toContainText('другому аккаунту');
    expect((await (await pa.request.get('/api/v1/auth/session')).json()).user.emailVerified).toBe(false);
    await pa.goto('/verify-email.html');await pa.goto(link);await expect(pa).not.toHaveURL(/token=/);await expect(pa.getByRole('button',{name:'Подтвердить email',exact:true})).toBeEnabled();
    expect((await (await pa.request.get('/api/v1/auth/session')).json()).user.emailVerified).toBe(false);
    await pa.getByRole('button',{name:'Подтвердить email',exact:true}).click();await expect(pa.getByRole('status')).toContainText('Email подтверждён');
  }finally{await a.close();await b.close();}
});

test('Email recovery replaces the password and revokes the former session',async({browser,request})=>{
  const context=await isolatedContext(browser),page=await context.newPage(),email='journey-recovery@example.invalid';
  try{
    await register(page,email,'Recovery journey');
    const reset=await context.newPage();await reset.goto('/reset.html');await reset.getByLabel('Email аккаунта',{exact:true}).fill(email);await reset.getByRole('button',{name:'Получить письмо',exact:true}).click();
    await expect.poll(async()=>{const r=await request.get(controls+'/inbox?email='+encodeURIComponent(email));return(await r.json()).length;}).toBe(1);
    const messages=await(await request.get(controls+'/inbox?email='+encodeURIComponent(email))).json(),link=messages[0].text.match(/http:\/\/\S+/)[0];
    await reset.goto(link);await expect(reset).not.toHaveURL(/token=/);await reset.getByLabel('Email аккаунта',{exact:true}).fill(email);
    await reset.getByLabel('Новый пароль · от 12 символов',{exact:true}).fill('Replacement browser password 2026');await reset.getByRole('button',{name:'Сменить пароль',exact:true}).click();
    await expect(reset.getByRole('status')).toContainText('Пароль изменён');expect((await(await page.request.get('/api/v1/auth/session')).json()).user).toBeNull();
  }finally{await context.close();}
});

test('Pro expiry blocks stale-tab premium writes while preserving schema export and ordinary analysis',async({browser,request})=>{
  const context=await isolatedContext(browser),page=await context.newPage(),email='journey-expiry@example.invalid';
  const schema={name:'Expiry snapshot',sql:'CREATE TABLE customers(id int,name text);'};
  try{
    await register(page,email,'Expiry journey');
    await page.getByRole('button',{name:'Схемы PRO',exact:false}).click();
    await expect(page.locator('#btn-schema-save')).toBeDisabled();
    expect((await page.request.post('/api/v1/schemas',{data:{...schema,pro:true,plan:'team'}})).status()).toBe(403);
    expect((await request.post(controls+'/grant-pro',{data:{email}})).ok()).toBeTruthy();
    await page.reload();await page.getByRole('button',{name:'Схемы PRO',exact:false}).click();
    await page.getByLabel('Название снимка',{exact:true}).fill(schema.name);
    await page.getByLabel('Структура схемы',{exact:true}).fill(schema.sql);
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/v1/schemas')&&r.request().method()==='POST');
    await page.locator('#btn-schema-save').click();const savedResponse=await saved;
    expect(savedResponse.status()).toBe(201);const id=(await savedResponse.json()).profile.id;
    await expect(page.locator('#schema-list')).toContainText(schema.name);
    expect((await request.post(controls+'/expire-pro',{data:{email}})).ok()).toBeTruthy();
    // Keep the tab's old Pro state: the server must reject it independently.
    await page.getByLabel('Название снимка',{exact:true}).fill('Forbidden after expiry');
    await page.getByLabel('Структура схемы',{exact:true}).fill(schema.sql);
    const rejected=page.waitForResponse(r=>r.url().endsWith('/api/v1/schemas')&&r.request().method()==='POST');
    await page.locator('#btn-schema-save').click();expect((await rejected).status()).toBe(403);
    await expect(page.locator('#schema-message')).toContainText('LockGuard Pro');
    expect((await page.request.post('/api/v1/analyze',{data:{sql:'SELECT 1;',schemaId:id,pro:true}})).status()).toBe(403);
    expect((await page.request.get('/api/v1/schemas/'+id)).status()).toBe(200);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Экспорт JSON',exact:true}).click();
    const artifact=await download,exported=JSON.parse(await require('node:fs/promises').readFile(await artifact.path(),'utf8'));
    expect(exported.tables.map(table=>table.name)).toEqual(['customers']);
    await page.locator('#btn-schemas-refresh').click();await expect(page.locator('#btn-schema-save')).toBeDisabled();
    await expect(page.locator('#analysis-schema-select')).toBeDisabled();await expect(page.locator('#schema-list')).toContainText(schema.name);
    expect((await page.request.post('/api/v1/analyze',{data:{sql:"SET lock_timeout='3s'; ALTER TABLE customers ADD COLUMN note text;"}})).status()).toBe(200);
  }finally{await context.close();}
});
