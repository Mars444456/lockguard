const {test,expect}=require('@playwright/test');
const password='Synthetic mobile account password 2026';
const table='orders_with_a_descriptive_name_for_mobile_layout_checks';
const index='orders_customer_lookup_index_with_a_descriptive_name';
const sql=`CREATE INDEX ${index} ON ${table}(customer_id);`;

async function fits(page,width){
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
}

for(const language of ['ru','en'])for(const width of [320,390])test(`Mobile ${language} registration, SQL review and saved report fit ${width}px`,async({browser})=>{
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  await context.route(/^https?:/,route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage(),email=`mobile-${language}-${width}@example.invalid`;
  try{
    await page.goto('/?lang='+language);await expect(page.locator('html')).toHaveAttribute('lang',language);await fits(page,width);
    await page.locator('#btn-account').click();await page.locator('#account-mode-register').click();
    await page.locator('#account-email').fill(email);
    await page.locator('#account-organization').fill('Mobile team '+ 'X'.repeat(80));
    await page.locator('#account-password').fill(password);
    await expect(page.locator('#account-auth-submit')).toHaveText(language==='en'?'Create account':'Создать аккаунт');
    await fits(page,width);await page.locator('#account-auth-submit').click();
    await expect(page.locator('#account-profile-email')).toHaveText(email);await fits(page,width);
    await page.locator('#btn-account-close').click();
    await page.locator('#sql-input').fill(sql);
    await expect(page.locator('#btn-analyze')).toHaveText(language==='en'?'Review SQL':'Проверить SQL');
    await page.locator('#btn-analyze').click();await expect(page.locator('#analysis-details')).toBeVisible();
    await expect(page.locator('#res-max-lock')).toHaveText('SHARE');
    const report=await page.locator('#pr-markdown-box').innerText();
    expect(report).toContain('LG-002');expect(report).toContain(table);await fits(page,width);
    const other=language==='en'?'ru':'en';await page.locator(`[data-language="${other}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('lang',other);
    await expect(page.locator('#sql-input')).toHaveValue(sql);await expect(page.locator('#pr-markdown-box')).toHaveText(report);await fits(page,width);
    await page.locator('[data-tab="runs"]').click();
    await expect(page.locator('#runs-tbody')).toContainText('SHARE');
    await page.locator('#runs-tbody button').first().click();
    await expect(page.locator('#run-report-body')).toHaveText(report);await fits(page,width);
    await page.locator('[data-tab="schemas"]').click();await expect(page.locator('#btn-schema-save')).toBeDisabled();await fits(page,width);
    expect((await page.request.post('/api/v1/schemas',{data:{name:'Forbidden mobile upgrade',sql:'CREATE TABLE forbidden(id int);',pro:true,plan:'team'}})).status()).toBe(403);
  }finally{await context.close();}
});
