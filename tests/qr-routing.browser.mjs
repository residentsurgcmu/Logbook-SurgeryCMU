import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');const html=await readFile(new URL('./qr-routing-browser.html',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.RC04_CHROME?{executablePath:process.env.RC04_CHROME,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
const T='0b9d6c9e-1f2a-4c3b-8d4e-5f6a7b8c9d0e';
try{
 for(const screen of ['staff','attendance']){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),calls=[];
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='127.0.0.1')return /^\/(attendance|evaluate)\//.test(u.pathname)?route.fulfill({contentType:'text/html',body:html}):route.continue();
    const name=u.pathname.split('/').at(-1);calls.push(name);
    if(name==='check_in_resident_round')return route.fulfill({json:[{session_id:'fixture-round',checked_in_at:new Date().toISOString(),already_checked_in:false}]});
    if(name==='resolve_resident_assessment_qr')return route.fulfill({json:[{user_id:'fixture-resident',full_name:'Fixture Resident',pgy:1}]});
    return route.fulfill({json:[]});
  });
  await page.goto(`http://127.0.0.1:5183/tests/qr-routing-browser.html?screen=${screen}`);
  if(screen==='staff'){
   await page.getByLabel('ลิงก์หรือรหัส QR',{exact:true}).fill(`https://resident-surgery-logbook.vercel.app/attendance/${T}`);
   await page.getByRole('button',{name:'ตรวจสอบ QR',exact:true}).click();
   await page.getByText('เช็คชื่อสำเร็จ',{exact:true}).waitFor();assert.ok(calls.includes('check_in_resident_round'));assert.ok(!calls.includes('resolve_resident_assessment_qr'));
  }else{
   await page.getByLabel('วางลิงก์จาก QR',{exact:true}).fill(`https://resident-surgery-logbook.vercel.app/evaluate/${T}`);
   await page.getByRole('button',{name:'ใช้ลิงก์นี้',exact:true}).click();
   await page.getByText('Fixture Resident',{exact:true}).waitFor();assert.ok(calls.includes('resolve_resident_assessment_qr'));assert.ok(!calls.includes('check_in_resident_round'));
  }
  await context.close();console.log(`PASS scanner ${screen} routes to the other QR flow without calling the wrong API`);
 }
 const context=await browser.newContext(),page=await context.newPage();const calls=[];
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(calls.push(route.request().url()),route.fulfill({json:[]})));
 await page.goto('http://127.0.0.1:5183/tests/qr-routing-browser.html?screen=attendance&role=resident');
 await page.getByLabel('วางลิงก์จาก QR',{exact:true}).fill(`/evaluate/${T}`);await page.getByRole('button',{name:'ใช้ลิงก์นี้',exact:true}).click();
 await page.getByText('QR ประเมินนี้ใช้สำหรับ Staff กรุณาเข้าสู่ระบบด้วยบัญชี Staff',{exact:true}).waitFor();assert.ok(!calls.some(c=>c.includes('resolve_resident_assessment_qr')));await context.close();console.log('PASS Resident assessment QR stays forbidden');
}finally{await browser.close();}
