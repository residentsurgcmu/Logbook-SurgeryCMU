import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
globalThis.window={location:{pathname:'/',search:'?demo'}};
globalThis.fetch=()=>{throw new Error('No external network allowed in render check')};
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
try {
 const {default:Platform}=await server.ssrLoadModule('/src/features/ResidentPlatform.jsx');
 const {CornerService}=await server.ssrLoadModule('/src/features/ResidentCornerHome.jsx');
 for (const role of ['resident','staff','admin']) {
  const user={id:'u1',role,name:'บัญชีทดสอบ',pgy:role==='resident'?3:null};
  const workspace={user,profiles:[],templates:[],requests:[],assessments:[],assignments:[],notifications:[],examRecords:[],staffDirectory:[],registeredStaff:[]};
  const render=()=>renderToStaticMarkup(React.createElement(Platform,{workspace,onRefresh:async()=>{},onLogout:()=>{}}));
  window.location.pathname='/';
  const html=render();
  assert.ok(html.includes('Resident Corner'));
  for(const text of ['New admissions','Friday conference','คลังวิดีโอ','ตารางเวร','บัญชีที่เชื่อมต่อ']) assert.ok(html.includes(text),role+': '+text);
  assert.equal(html.includes('คิวประเมินของคุณ'),role==='staff');
  const token='0f8fad5b-d9cb-469f-a165-70867728950e';
  if(role!=='admin') {window.location.pathname='/attendance/'+token;assert.ok(render().includes('<h1>เช็กชื่อ MM &amp; Grand Round</h1>'));}
  if(role==='staff') {window.location.pathname='/evaluate/'+token;assert.ok(render().includes('<h1>สแกน QR เพื่อประเมิน</h1>'));}
 }
 for(const service of ['videos','schedule','accounts']) {
  const html=renderToStaticMarkup(React.createElement(CornerService,{service,onNavigate:()=>{}}));
  assert.ok(html.includes('ยังไม่เปิดใช้งาน'));
 }
 console.log('PASS: React render of Resident/Staff/Admin homes, service states and attendance/evaluation QR initial destinations. No backend access.');
} finally {await server.close();}
