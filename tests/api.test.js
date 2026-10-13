const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

test('end-to-end e-waste lifecycle and role boundaries', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ecotrace-test-'));
  const db = openDatabase(path.join(dir,'test.db'), {
    ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'admin-passphrase-123',
    COLLECTOR_EMAIL:'collector@example.test',COLLECTOR_PASSWORD:'collector-passphrase-123',
    RECYCLER_EMAIL:'recycler@example.test',RECYCLER_PASSWORD:'recycler-passphrase-123'
  });
  const server = createApp({db});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close(); fs.rmSync(dir,{recursive:true,force:true});
  });
  const sessions = {};
  async function call(method,endpoint,payload,role) {
    const response = await fetch(base+endpoint,{
      method,
      headers:{...(payload?{'content-type':'application/json'}:{}),...(role?{cookie:sessions[role]}:{})},
      body:payload?JSON.stringify(payload):undefined
    });
    const cookie=response.headers.get('set-cookie');
    if(cookie && role) sessions[role]=cookie.split(';')[0];
    return {status:response.status,data:await response.json()};
  }
  async function login(role,email,password,expectedRole=role) {
    const response=await call('POST','/api/auth/login',{email,password},role);
    assert.equal(response.status,200);
    assert.equal(response.data.user.role,expectedRole);
  }
  let pickupId, code, collectorId;

  await t.test('health, seeded categories and centers', async () => {
    assert.deepEqual((await call('GET','/api/health')).data,{status:'ok',service:'e-waste-system'});
    assert.equal((await call('GET','/api/categories')).data.length,6);
    assert.equal((await call('GET','/api/centers')).data.length,2);
  });
  await t.test('registration, login and session cookie', async () => {
    assert.equal((await call('POST','/api/auth/register',{name:'Demo Customer',email:'customer@example.test',password:'customer-passphrase-123'})).status,201);
    assert.equal((await call('POST','/api/auth/register',{name:'Again',email:'customer@example.test',password:'customer-passphrase-123'})).status,409);
    assert.equal((await call('POST','/api/auth/login',{email:'customer@example.test',password:'wrong-password'})).status,401);
    await login('customer','customer@example.test','customer-passphrase-123');
    assert.equal((await call('GET','/api/auth/me',undefined,'customer')).data.user.name,'Demo Customer');
  });
  await t.test('request validation and protected access', async () => {
    assert.equal((await call('GET','/api/pickups')).status,401);
    assert.equal((await call('POST','/api/pickups',{categoryId:999},'customer')).status,400);
    assert.equal((await call('GET','/api/admin/dashboard',undefined,'customer')).status,403);
  });
  await t.test('customer creates a pickup and can read its private details', async () => {
    const preferredDate=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const result=await call('POST','/api/pickups',{
      categoryId:1,itemName:'Old smartphone',quantity:2,estimatedWeightKg:1.4,
      address:'42 Circular Street, Chennai 600001',preferredDate,notes:'Call before arriving'
    },'customer');
    assert.equal(result.status,201);
    pickupId=result.data.id; code=result.data.tracking_code;
    assert.match(code,/^EWT-\d{4}-[A-F0-9]{8}$/);
    assert.equal(result.data.timeline.length,1);
    assert.equal((await call('GET','/api/pickups',undefined,'customer')).data.length,1);
    assert.equal((await call('GET',`/api/pickups/${pickupId}`,undefined,'customer')).data.address,'42 Circular Street, Chennai 600001');
  });
  await t.test('public tracking excludes personal information', async () => {
    const result=await call('GET',`/api/track?code=${code}`);
    assert.equal(result.status,200); assert.equal(result.data.status,'requested');
    assert.equal('address' in result.data,false);
    assert.equal('customer_name' in result.data,false);
    assert.equal((await call('GET','/api/track?code=UNKNOWN')).status,404);
  });
  await t.test('other customers cannot see someone else’s pickup', async () => {
    await call('POST','/api/auth/register',{name:'Other Customer',email:'other@example.test',password:'other-passphrase-123'});
    await login('other','other@example.test','other-passphrase-123','customer');
    assert.equal((await call('GET',`/api/pickups/${pickupId}`,undefined,'other')).status,403);
    assert.equal((await call('GET','/api/pickups',undefined,'other')).data.length,0);
  });
  await t.test('administrator sees metrics, roles and assigns collector', async () => {
    await login('admin','admin@example.test','admin-passphrase-123');
    const metrics=await call('GET','/api/admin/dashboard',undefined,'admin');
    assert.equal(metrics.data.summary.total,1);
    const users=(await call('GET','/api/admin/users',undefined,'admin')).data;
    collectorId=users.find(u=>u.role==='collector').id;
    assert.equal((await call('PATCH',`/api/admin/pickups/${pickupId}/assign`,{collectorId},'admin')).data.status,'assigned');
    assert.equal((await call('PATCH',`/api/admin/pickups/${pickupId}/assign`,{collectorId:999},'admin')).status,400);
    assert.ok((await call('GET','/api/admin/audit',undefined,'admin')).data.length>=2);
  });
  await t.test('collector accepts and collects assigned pickup', async () => {
    await login('collector','collector@example.test','collector-passphrase-123');
    assert.equal((await call('GET','/api/pickups',undefined,'collector')).data.length,1);
    assert.equal((await call('PATCH',`/api/collector/pickups/${pickupId}/status`,{status:'collected'},'collector')).status,409);
    assert.equal((await call('PATCH',`/api/collector/pickups/${pickupId}/status`,{status:'accepted'},'collector')).data.status,'accepted');
    assert.equal((await call('PATCH',`/api/collector/pickups/${pickupId}/status`,{status:'collected'},'collector')).data.status,'collected');
  });
  await t.test('recycler records arrival, processing weight and certificate', async () => {
    await login('recycler','recycler@example.test','recycler-passphrase-123');
    assert.equal((await call('PATCH',`/api/recycler/pickups/${pickupId}/status`,{status:'recycled',actualWeightKg:1.2,centerId:2,method:'Material recovery'},'recycler')).status,409);
    assert.equal((await call('PATCH',`/api/recycler/pickups/${pickupId}/status`,{status:'received',centerId:2},'recycler')).data.status,'received');
    const result=await call('PATCH',`/api/recycler/pickups/${pickupId}/status`,{status:'recycled',actualWeightKg:1.2,centerId:2,method:'Material recovery'},'recycler');
    assert.equal(result.data.status,'recycled');
    assert.equal(result.data.actual_weight_kg,1.2);
    assert.equal(result.data.certificate_no,`CERT-${code}`);
    assert.equal(result.data.timeline.length,6);
    assert.equal((await call('GET',`/api/track?code=${code}`)).data.certificate_no,`CERT-${code}`);
  });
  await t.test('completed pickups cannot be cancelled; logout ends session', async () => {
    assert.equal((await call('DELETE',`/api/pickups/${pickupId}`,undefined,'customer')).status,409);
    assert.equal((await call('POST','/api/auth/logout',undefined,'customer')).status,200);
    assert.equal((await call('GET','/api/pickups',undefined,'customer')).status,401);
  });
});
