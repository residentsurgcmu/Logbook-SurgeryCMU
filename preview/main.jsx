import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ResidentPlatform from '../src/features/ResidentPlatform';
import '../src/styles.css';
import '../src/resident.css';
import '../src/residentCorner.css';
import './preview.css';

const names = {resident:'Resident ตัวอย่าง',staff:'Staff ตัวอย่าง',admin:'Admin ตัวอย่าง'};
const moduleNames = {
 cases:'New admissions', conference:'Friday conference', attendance:'เช็คชื่อประชุม',
 'round-admin':'จัดกิจกรรม MM / Grand Round', request:'ส่งแบบประเมิน EPA / PBA', pending:'คิวประเมิน',
 scan:'สแกน QR ประเมิน', qr:'QR ของฉัน', dashboard:'ภาพรวม EPA / PBA', history:'ผลการประเมิน',
 notifications:'การแจ้งเตือน', exams:'การสอบ', export:'Export ข้อมูล', admin:'จัดการระบบ',
};
function fixture(role, empty) {
 const id={resident:'r1',staff:'s1',admin:'a1'}[role];
 const requests=empty?[]:[
  {id:'q1',resident_id:'r1',staff_id:'s1',status:'pending',procedure_or_activity:'การประเมินผู้ป่วยก่อนผ่าตัด — เคสสมมติ',resident_template_definitions:{template_code:'EPA 1',title:'การประเมินก่อนผ่าตัด'}},
  {id:'q2',resident_id:'r2',staff_id:'s1',status:'pending',procedure_or_activity:'อภิปรายแผนการดูแล — เคสสมมติ',resident_template_definitions:{template_code:'EPA 2',title:'การวางแผนดูแล'}},
  {id:'q3',resident_id:'r1',staff_id:'s2',status:'pending',procedure_or_activity:'ทบทวนหัตถการ — เคสสมมติ',resident_template_definitions:{template_code:'PBA',title:'ทบทวนหัตถการ'}},
 ];
 return {user:{id,role,name:names[role],pgy:role==='resident'?3:null},
  profiles:[{id:'r1',name:'Resident ตัวอย่าง A',pgy:3},{id:'r2',name:'Resident ตัวอย่าง B',pgy:2}],
  requests:requests.filter(row=>role==='admin' || (role==='staff'?row.staff_id===id:row.resident_id===id)), assessments:empty?[]:[{id:'a1',resident_id:'r1',evaluator_id:'s1'},{id:'a2',resident_id:'r2',evaluator_id:'s1'},{id:'a3',resident_id:'r1',evaluator_id:'s2'}],
  notifications:empty?[]:[{id:'n1',recipient_id:id,read_at:null},{id:'n2',recipient_id:id,read_at:null}],
  templates:[],assignments:[],examRecords:[],staffDirectory:[],registeredStaff:[]};
}
function ModuleBoundary({tab,onHome}) {
 return <section className="resident-panel preview-boundary">
  <span className="corner-count">ขอบเขตรอบนี้: หน้าแรกและเมนู</span>
  <h2>{moduleNames[tab] || tab}</h2>
  <p>เมนูนี้เชื่อมไปยังโมดูลเดิมในโค้ดอาจารย์แล้ว แต่ไฟล์ preview นี้ยังไม่เปิดการทำงานภายในโมดูล เพื่อให้ตรวจโครงสร้างหน้าแรกและทางเข้าแต่ละส่วนก่อน</p>
  <p>ยังไม่มีการกรอกเคส ให้คะแนน เช็คชื่อ หรือบันทึกข้อมูลจากหน้านี้</p>
  <button type="button" className="secondary-button" onClick={onHome}>กลับหน้าแรก</button>
 </section>;
}
function Preview() {
 const [role,setRole]=useState('resident');
 const [empty,setEmpty]=useState(false);
 const [logout,setLogout]=useState(false);
 return <>
  <div className="preview-controls" role="region" aria-label="เครื่องมือทดลอง">
   <div><strong>LOCAL PREVIEW · รอบ 1</strong><small>ข้อมูลสมมติ · ใช้งานออฟไลน์ · ไม่บันทึกข้อมูล</small></div>
   <label>ทดลองบทบาท<select aria-label="ทดลองบทบาท" value={role} onChange={e=>{setRole(e.target.value);setLogout(false);}}><option value="resident">Resident</option><option value="staff">Staff</option><option value="admin">Admin</option></select></label>
   <label className="preview-empty"><input type="checkbox" checked={empty} onChange={e=>setEmpty(e.target.checked)}/>ทดลองไม่มีรายการ</label>
  </div>
  {logout?<main className="preview-boundary resident-panel"><h1>ออกจาก preview แล้ว</h1><p>นี่เป็นการจำลอง ไม่มีบัญชีจริงเชื่อมต่ออยู่</p><button className="primary-button" onClick={()=>setLogout(false)}>กลับเข้า preview</button></main>:
  <ResidentPlatform key={role+String(empty)} workspace={fixture(role,empty)} onRefresh={async()=>{}} onLogout={()=>setLogout(true)} renderModulePreview={(tab,onHome)=><ModuleBoundary tab={tab} onHome={onHome}/>} />}
 </>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
