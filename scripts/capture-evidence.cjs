/* Capture real browser views of the deployed demonstration workflow.
 * Requires Playwright available through ECOTRACE_PLAYWRIGHT_MODULE and Microsoft Edge.
 * Run only against a local demonstration instance; this creates sample records.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.ECOTRACE_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname,'..');
const out = path.join(root,'screenshots');
const base = 'http://localhost:8092';
const env = Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8')
  .split(/\r?\n/).filter(line=>line && !line.startsWith('#')).map(line=>{
    const at=line.indexOf('='); return [line.slice(0,at),line.slice(at+1)];
  }));
fs.mkdirSync(out,{recursive:true});

async function request(method,endpoint,body,cookie) {
  const response=await fetch(base+endpoint,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${data.error}`);
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email,password) {
  return (await request('POST','/api/auth/login',{email,password})).cookie;
}
async function pageFor(browser,cookie,viewport={width:1440,height:900}) {
  const context=await browser.newContext({viewport,deviceScaleFactor:1});
  if(cookie) {
    const [name,value]=cookie.split('=');
    await context.addCookies([{name,value,url:base,httpOnly:true,sameSite:'Lax'}]);
  }
  const page=await context.newPage();
  await page.goto(base,{waitUntil:'networkidle'});
  return {page,context};
}
async function shot(page,name,fullPage=false) {
  await page.screenshot({path:path.join(out,name),fullPage,animations:'disabled'});
  console.log(`Captured ${name}`);
}

(async()=>{
  const executablePath=process.env.ECOTRACE_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser=await chromium.launch({headless:true,executablePath});
  try {
    let view=await pageFor(browser,null);
    await shot(view.page,'01-home-desktop.png',true);
    await view.context.close();
    view=await pageFor(browser,null,{width:390,height:844});
    await shot(view.page,'02-home-mobile.png',true);
    await view.context.close();

    const suffix=Date.now().toString(36);
    const customerEmail=`demo.${suffix}@example.test`;
    const customerPassword=`demo-passphrase-${suffix}`;
    await request('POST','/api/auth/register',{name:'Demo Customer',email:customerEmail,password:customerPassword});
    const customerCookie=await login(customerEmail,customerPassword);
    const pickup=(await request('POST','/api/pickups',{
      categoryId:2,itemName:'Retired laptop and monitor',quantity:2,estimatedWeightKg:8.4,
      address:'42 Demonstration Street, Chennai 600001',
      preferredDate:new Date(Date.now()+2*86400000).toISOString().slice(0,10),
      notes:'Demo pickup for project walkthrough'
    },customerCookie)).data;
    view=await pageFor(browser,customerCookie);
    await shot(view.page,'03-customer-workspace.png');
    await view.page.getByRole('button',{name:'Details'}).first().click();
    await view.page.locator('#modal[aria-hidden="false"]').waitFor();
    await shot(view.page,'04-pickup-traceability.png');
    await view.context.close();

    const adminCookie=await login(env.ADMIN_EMAIL,env.ADMIN_PASSWORD);
    view=await pageFor(browser,adminCookie);
    await shot(view.page,'05-admin-dashboard.png');
    await view.context.close();
    const staff=(await request('GET','/api/admin/users',undefined,adminCookie)).data;
    const collector=staff.find(user=>user.role==='collector');
    await request('PATCH',`/api/admin/pickups/${pickup.id}/assign`,{collectorId:collector.id},adminCookie);

    const collectorCookie=await login(env.COLLECTOR_EMAIL,env.COLLECTOR_PASSWORD);
    view=await pageFor(browser,collectorCookie);
    await shot(view.page,'06-collector-workspace.png');
    await view.context.close();
    await request('PATCH',`/api/collector/pickups/${pickup.id}/status`,{status:'accepted'},collectorCookie);
    await request('PATCH',`/api/collector/pickups/${pickup.id}/status`,{status:'collected'},collectorCookie);

    const recyclerCookie=await login(env.RECYCLER_EMAIL,env.RECYCLER_PASSWORD);
    view=await pageFor(browser,recyclerCookie);
    await shot(view.page,'07-recycler-workspace.png');
    await view.context.close();
    await request('PATCH',`/api/recycler/pickups/${pickup.id}/status`,{status:'received',centerId:2},recyclerCookie);
    await request('PATCH',`/api/recycler/pickups/${pickup.id}/status`,{status:'recycled',centerId:2,actualWeightKg:7.9,method:'Component recovery and materials separation'},recyclerCookie);

    view=await pageFor(browser,null);
    await view.page.locator('#track-code').fill(pickup.tracking_code);
    await view.page.getByRole('button',{name:'Track now'}).click();
    await view.page.getByText('Journey found.').waitFor();
    await shot(view.page,'08-public-tracking.png');
    await view.context.close();
    view=await pageFor(browser,customerCookie);
    await view.page.getByRole('button',{name:'Details'}).first().click();
    await view.page.locator('#modal[aria-hidden="false"]').waitFor();
    await shot(view.page,'09-recycling-record.png');
    await view.context.close();
    console.log(`Demo tracking code: ${pickup.tracking_code}`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
