import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.RC04_CHROME||'/tmp/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [390,768,1280]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();let saved=null,events=[];const errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();
   const name=u.pathname.split('/').at(-1),body=route.request().postDataJSON();
   if(name==='admin_list_accounts')return route.fulfill({json:[{user_id:'c0000000-0000-4000-8000-000000000002',full_name:'Fixture Resident',pgy:1,role:'resident',active:true}]});
   if(name==='rc04_admin_list_exams')return route.fulfill({json:[]});
   if(name==='list_resident_calendar_events')return route.fulfill({json:events});
   if(name==='save_resident_calendar_event'){saved=body;events=[{...body.p_payload,id:body.p_id,version:1,admin_payload:body.p_payload,participant_count:1}];return route.fulfill({json:{id:body.p_id,version:1,participant_count:1}});}
   throw new Error('Unexpected RPC '+name);
  });
  await page.goto('http://127.0.0.1:5183/tests/calendar-browser.html');
  await page.getByRole('button',{name:'เพิ่มกำหนดการ',exact:true}).click();
  await page.getByLabel('ชื่อการสอบ / กิจกรรม',{exact:true}).fill('X-ray Anatomy fixture');
  await page.getByLabel('เริ่ม (เวลาไทย)',{exact:true}).fill('2027-01-02T09:00');await page.getByLabel('สิ้นสุด (เวลาไทย)',{exact:true}).fill('2027-01-02T12:00');
  await page.getByLabel('สถานะ',{exact:true}).selectOption('published');await page.getByLabel('ผู้เข้าร่วม',{exact:true}).selectOption('selected');
  await page.getByLabel('Fixture Resident · PGY 1',{exact:true}).check();
  await page.getByRole('button',{name:'บันทึกกำหนดการ',exact:true}).click();
  await page.getByText('บันทึกกำหนดการแล้ว',{exact:true}).waitFor();
  assert.equal(saved.p_payload.starts_at,'2027-01-02T02:00:00.000Z');assert.equal(saved.p_expected_version,0);assert.equal(saved.p_payload.status,'published');assert.deepEqual(saved.p_payload.user_ids,['c0000000-0000-4000-8000-000000000002']);
  await page.getByRole('table',{name:/ปฏิทิน/}).waitFor();
  await page.getByRole('heading',{name:'X-ray Anatomy fixture',exact:true}).waitFor();
  await page.getByRole('button',{name:'รายการ',exact:true}).click();
  await page.getByRole('heading',{name:'X-ray Anatomy fixture',exact:true}).waitFor();
  await page.getByRole('button',{name:'ปฏิทิน',exact:true}).click();
  await page.locator('[data-calendar-day="2027-01-03"]').click();
  await page.getByText('ไม่มีกำหนดการในวันที่เลือก',{exact:true}).waitFor();
  await page.locator('[data-calendar-day="2027-01-02"]').click();
  await page.locator('[data-calendar-day="2027-01-02"]').press('ArrowRight');
  assert.equal(await page.locator('[data-calendar-day="2027-01-03"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-calendar-day="2027-01-02"]').click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.deepEqual(errors,[]);await page.screenshot({path:`/tmp/rc-calendar-${width}.png`,fullPage:true});
  await context.close();console.log(`PASS Admin publish selected resident, Thai time and viewport ${width}`);
 }
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({json:[{id:'fixture',title:'Published exam',kind:'exam',status:'published',starts_at:'2027-01-02T02:00:00Z',ends_at:'2027-01-02T05:00:00Z',location:'Room A',description:'Instructions',exam_id:null}]}));
 await page.goto('http://127.0.0.1:5183/tests/calendar-browser.html?role=resident');await page.getByLabel('เดือน',{exact:true}).fill('2027-01');await page.locator('[data-calendar-day="2027-01-02"]').click();await page.getByRole('heading',{name:'Published exam',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'เพิ่มกำหนดการ',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'ไปหน้าผลสอบ',exact:true}).count(),0);
 await page.goto('http://127.0.0.1:5183/tests/calendar-browser.html?role=upcoming');await page.getByRole('heading',{name:'Published exam',exact:true}).waitFor();await page.getByRole('button',{name:'ดูปฏิทินทั้งหมด →',exact:true}).waitFor();
 console.log('PASS Resident no editing or unpublished-result link; upcoming card');await context.close();
}finally{await browser.close();}
