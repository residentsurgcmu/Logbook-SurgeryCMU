// Local Vite :5180 with fixture Supabase env. All external traffic is mocked.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({headless:true, ...(process.env.RC04_CHROME ? {executablePath:process.env.RC04_CHROME,args:['--no-sandbox','--disable-dev-shm-usage']} : {})});
const base='http://127.0.0.1:5180';
try {
 for (const type of ['invite','recovery']) {
  const context=await browser.newContext({viewport:{width:390,height:844}}), page=await context.newPage(), calls=[];
  const user={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',aud:'authenticated',role:'authenticated',email:'test@example.invalid',app_metadata:{},user_metadata:{}};
  const token=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url'),'fixture'].join('.');
  await context.route('**/*',route=>{
   const url=new URL(route.request().url()); if(url.hostname==='127.0.0.1') return route.continue();
   calls.push({path:url.pathname,body:route.request().postDataJSON()});
   if(url.pathname.endsWith('/verify')) return route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user}});
   if(url.pathname.endsWith('/user')) return route.fulfill({json:user});
   if(url.pathname.endsWith('/logout')) return route.fulfill({status:204});
   return route.abort();
  });
  await page.goto(`${base}/confirm-password#token_hash=${'a'.repeat(64)}&type=${type}`);
  await page.getByRole('button',{name:'ยืนยันและตั้งรหัสผ่าน',exact:true}).waitFor();
  await page.waitForTimeout(350);
  assert.equal(calls.length,0,'page load must not redeem token or load workspace');
  assert.equal(new URL(page.url()).hash,'','secret cleared from history');
  await page.getByRole('button',{name:'ยืนยันและตั้งรหัสผ่าน',exact:true}).click();
  await page.getByRole('heading',{name:'ตั้งรหัสผ่านใหม่',exact:true}).waitFor();
  assert.equal(calls.filter(c=>c.path.endsWith('/verify')).length,1);
  assert.deepEqual(calls[0].body,{token_hash:'a'.repeat(64),type,gotrue_meta_security:{}});
  await page.getByLabel('รหัสผ่านใหม่',{exact:true}).fill('FixturePassword123!');
  await page.getByLabel('ยืนยันรหัสผ่าน',{exact:true}).fill('FixturePassword123!');
  await page.getByRole('button',{name:'บันทึกรหัสผ่าน',exact:true}).click();
  await page.getByText('ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง',{exact:true}).waitFor();
  assert.ok(calls.some(c=>c.path.endsWith('/user')&&c.body?.password==='FixturePassword123!'));
  await context.close(); console.log(`PASS ${type}: no prefetch redemption, explicit confirmation, password update, return to login`);
 }
 const context=await browser.newContext(),page=await context.newPage();let calls=0;
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(calls++,route.abort()));
 await page.goto(`${base}/confirm-password#token_hash=invalid&type=invite`);
 await page.getByText('ไม่พบ session สำหรับตั้งรหัสผ่าน',{exact:true}).waitFor();assert.equal(calls,0);await context.close();console.log('PASS malformed token fails closed');
const rejected=await browser.newContext(),failed=await rejected.newPage();let attempts=0;
 await rejected.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.hostname==='127.0.0.1')return route.continue();
  if(url.pathname.endsWith('/verify')){attempts++;return route.fulfill({status:403,json:{code:'otp_expired',msg:'Token has expired or is invalid'}});}
  return route.abort();
 });
 await failed.goto(`${base}/confirm-password#token_hash=${'b'.repeat(64)}&type=recovery`);
 await failed.getByRole('button',{name:'ยืนยันและตั้งรหัสผ่าน',exact:true}).click();
 await failed.getByRole('alert').waitFor();assert.equal(attempts,1);assert.equal(await failed.getByLabel('รหัสผ่านใหม่',{exact:true}).count(),0);
 await rejected.close();console.log('PASS used/expired token cannot open password form');
} finally { await browser.close(); }
