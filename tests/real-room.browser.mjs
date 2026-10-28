import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const seats=JSON.parse(await readFile(new URL('./real-room-64-fixture.json',import.meta.url)));
const browser=await chromium.launch({headless:true,...(process.env.RC04_CHROME?{executablePath:process.env.RC04_CHROME,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
try {
 for(const width of [320,390,768,1280]) for(const role of ['staff','resident']){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();const calls=[],errors=[];let mySeat=null,hold=null;
 page.on('pageerror',e=>errors.push(e.message));
 const id='a0000000-0000-4000-8000-000000000001',now=Date.now(),start=new Date(now-3600000).toISOString(),end=new Date(now+3600000).toISOString();
 await context.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();const name=u.pathname.split('/').at(-1),args=route.request().postDataJSON();calls.push({name,args});let data=[];
 if(name==='list_resident_seat_sessions')data=[{session_id:id,meeting_date:new Date().toISOString().slice(0,10),starts_at:start,ends_at:end}];
 if(name==='hold_resident_seat'){hold={seat_code:args.p_seat_code,expires_at:new Date(Date.now()+60000).toISOString()};data=hold.expires_at;}
 if(name==='confirm_resident_seat'){mySeat=args.p_seat_code;hold=null;data=null;}
 if(name==='get_resident_seat_map')data={session:{id,open:true,ended:false,starts_at:start,ends_at:end,now:new Date().toISOString()},me:{user_id:'fixture-user',role,in_room:true,checked_in_at:start,seat:mySeat,hold},seats:seats.map(s=>({...s,held:hold?.seat_code===s.seat_code,occupant:mySeat===s.seat_code?{user_id:'fixture-user',name:'Fixture Attendee',role}:null})),people:[{user_id:'fixture-user',role,name:'Fixture Attendee',status:mySeat?'seat':'room'},{user_id:'fixture-resident',role:'resident',name:'Fixture Resident',status:'room'}],counts:{residents_in_room:1,residents_total:1,seats_taken:mySeat?1:0,seats_total:64}};
 return route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:5182/tests/real-room-browser.html?role=${role}`);
 await page.getByText('เลือกที่นั่งจากผังด้านล่าง',{exact:true}).waitFor();
 assert.equal(await page.locator('.seatmap-desktop-view .seatmap-seat').count(),64);
 if(width<900){await page.getByRole('button',{name:/^เปิดStaff ด้านหลัง/}).click();await page.locator('.seatmap-mobile-view [data-seat="S15"]').click();}
 else await page.locator('.seatmap-desktop-view [data-seat="S15"]').click();
 await page.getByRole('button',{name:'ยืนยันที่นั่งนี้',exact:true}).click();
 await page.getByText('ที่นั่ง S15',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.name==='hold_resident_seat').length,1);assert.ok(calls.some(c=>c.name==='confirm_resident_seat'));
 assert.equal(await page.getByRole('button',{name:'ใช้พื้นที่นั่งเสริม',exact:true}).count(),0,'numbered spare chairs replace anonymous reserve action');
 if(role==='staff'){
 await page.getByRole('button',{name:'จัดที่นั่งให้ Resident',exact:true}).click();
 if(width<900)await page.locator('.seatmap-mobile-view [data-seat="S14"]').click();else await page.locator('.seatmap-desktop-view [data-seat="S14"]').click();
 await page.getByRole('heading',{name:'จัดที่นั่ง S14',exact:true}).waitFor();assert.equal(calls.filter(c=>c.name==='hold_resident_seat').length,1,'management click must not hold a personal seat');
 await page.getByRole('button',{name:'ปิด',exact:true}).click();
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no document horizontal overflow');
 assert.deepEqual(errors,[]);if(role==='staff')await page.screenshot({path:`/tmp/real-room-${width}.png`,fullPage:true});
 await context.close();console.log(`PASS ${role} ${width}px: 64 chairs, self hold/confirm/name, distinct staff management and bounded width`);
 }
}finally{await browser.close();}
