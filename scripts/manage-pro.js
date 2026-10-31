// Operator-only local tool. It never records a payment or opens a public grant API.
const db = require('../src/server/db');
try {
  const [action, email, rawDays] = process.argv.slice(2);
  if (!['grant','revoke'].includes(action) || !email) throw new Error('Usage: npm run pro -- grant EMAIL DAYS | revoke EMAIL');
  const user=db.getUserByEmail(email);
  if(!user)throw new Error('Account not found. Register in the server application first.');
  const store=db.forOrganization(user.organizationId);
  if(action==='grant') {
    const days=Number(rawDays);
    if(!Number.isInteger(days) || days<1 || days>366)throw new Error('DAYS must be an integer from 1 to 366.');
    const org=store.getOrganization();
    const base=Math.max(Date.now(),Date.parse(org.accessUntil)||0);
    const accessUntil=new Date(base+days*86400000).toISOString();
    store.updateOrganization({plan:'team',subscriptionStatus:'active',billingProvider:'manual',accessUntil,monthlyChecksQuota:5000});
    console.log('Pro granted by operator until '+accessUntil+'. No payment was recorded.');
  } else {
    store.updateOrganization({plan:'free',subscriptionStatus:'inactive',accessUntil:new Date().toISOString(),monthlyChecksQuota:100});
    console.log('Pro revoked. Saved data remains available for export and deletion.');
  }
} catch(error) { console.error(error.message); process.exitCode=1; }
finally {db.close();}
