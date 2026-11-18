const {test,expect}=require('@playwright/test');
const path=require('node:path');
const controls='http://127.0.0.1:3021';
for(const language of ['ru','en'])test(`Free beta ${language}: register, save a schema and open features without a purchase`,async({browser,request})=>{
  await request.post(controls+'/enable-free-beta');
  const context=await browser.newContext(),page=await context.newPage();
  const purchases=[];
  await context.route(/^https?:/,route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v1/billing/checkout')purchases.push(url.pathname);
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  try {
    await page.goto('/?lang='+language);
    await page.locator('#btn-account-register').click();
    await page.locator('#account-email').fill('free-beta-'+language+'@example.invalid');
    await page.locator('#account-organization').fill('Synthetic beta team');
    await page.locator('#account-password').fill('Synthetic free beta password 2026');
    await page.locator('#account-auth-submit').click();
    await expect(page.locator('#org-plan-badge')).toHaveText(language==='en'?'Free beta':'Бесплатная бета');
    await page.locator('#btn-account-close').click();
    await page.locator('[data-tab="billing"]').click();
    await expect(page.locator('#btn-subscribe-team')).toHaveText(language==='en'?'Open for free':'Открыть бесплатно');
    await page.locator('#btn-subscribe-team').click();
    await expect(page.locator('#schema-fields')).toBeEnabled();
    await page.locator('#schema-name').fill('Synthetic beta schema');
    await page.locator('#schema-source').fill('CREATE TABLE orders(id int PRIMARY KEY);');
    await page.locator('#btn-schema-save').click();
    await expect(page.locator('#schema-list')).toContainText('Synthetic beta schema');
    const org=(await (await page.request.get('/api/v1/organization')).json()).organization;
    expect(org.plan).toBe('free');expect(org.features.freeBeta).toBe(true);expect(org.features.savedSchemas).toBe(10);
    expect(purchases).toEqual([]);
    await page.screenshot({path:path.resolve(__dirname,'../private/qa/free-beta-'+language+'.png')});
    await page.goto(controls+'/demo/index.html?lang='+language+'#pricing');
    const pricing=page.locator('#pricing');
    await expect(pricing).toContainText(language==='en'?'Try all features for free':'Попробуйте все возможности бесплатно');
    await expect(pricing).not.toContainText('1 500');
    if(language==='en')await pricing.screenshot({path:path.resolve(__dirname,'../private/qa/free-beta-public-en.png')});
    await pricing.locator('a[href="#account-access"]').click();
    await expect(page.locator('#account-access-dialog')).toBeVisible();
  } finally {
    await context.close();await request.post(controls+'/disable-free-beta');
  }
});
