import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({headless:true,...(process.env.RC04_CHROME?{executablePath:process.env.RC04_CHROME,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
try {
 for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();const calls=[];let sessions=[],configs=[];
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
 await context.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();
 const name=u.pathname.split('/').at(-1);const args=route.request().postDataJSON();let data=[];calls.push({name,args});
 if(name==='schedule_resident_round'){
   sessions=[{id:'a0000000-0000-4000-8000-000000000001',meeting_date:args.p_meeting_date,starts_at:`${args.p_meeting_date}T${args.p_start_time}:00+07:00`,ends_at:`${args.p_meeting_date}T${args.p_end_time}:00+07:00`,activity_start_time:args.p_activity_start,activity_end_time:args.p_activity_end}];
   configs=[{session_id:sessions[0].id,on_time_at:sessions[0].starts_at,layout_name:'Fixture Room',seated:0,pending_requests:0}];data=sessions[0].id;
 }else if(name==='resident_round_sessions')data=sessions;
 else if(name==='admin_list_seat_configs')data=configs;
 return route.fulfill({json:data});
 });
 await page.goto('http://127.0.0.1:5181/tests/round-workflow-browser.html');
 await page.getByLabel('วันที่ประชุม (ใช้ปี ค.ศ.)',{exact:true}).fill(tomorrow);
 await page.getByLabel('เวลาเริ่มประชุม',{exact:true}).fill('09:00');
 await page.getByLabel('เวลาจบประชุม',{exact:true}).fill('12:00');
 await page.getByRole('button',{name:'สร้างรอบประชุม',exact:true}).click();
 await page.getByText('Fixture Room',{exact:true}).waitFor();
 const create=calls.filter(c=>c.name==='schedule_resident_round');assert.equal(create.length,1);
 assert.deepEqual(create[0].args,{p_meeting_date:tomorrow,p_start_time:'09:00',p_end_time:'12:00',p_activity_start:'09:00',p_activity_end:'12:00',p_enable_seats:true});
 assert.equal(calls.filter(c=>c.name==='admin_configure_seat_session').length,0,'no second activation');
 assert.equal(await page.getByRole('button',{name:'เปิดผังที่นั่งของรอบนี้',exact:true}).count(),0);
 await page.getByRole('button',{name:'แก้ไขวันที่/เวลา',exact:true}).click();
 await page.getByLabel('เวลาเริ่มประชุม',{exact:true}).last().fill('10:00');
 await page.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
 await page.waitForTimeout(200);assert.ok(calls.some(c=>c.name==='reschedule_resident_round'&&c.args.p_start_time==='10:00'));
 await context.close();console.log(`PASS ${width}px: one action schedules QR+seats, edit uses atomic RPC`);
 }
}finally{await browser.close();}
