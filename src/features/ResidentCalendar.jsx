import React,{useEffect,useRef,useState} from 'react';
import {loadCalendar,saveCalendar} from '../residentCalendar';
import {listAdminAccounts,managedExamsApi} from '../residentApi';
import {bangkokInput,bangkokIso,calendarRange,calendarTime,calendarError,calendarMonthDays,calendarEventsForDay,shiftCalendarMonth,calendarDayLabel,calendarMonthLabel,CALENDAR_KINDS,CALENDAR_STATUSES} from '../calendarRules';

function EventCard({event,onEdit,onExams}) {
 return <article className={`calendar-event calendar-${event.status}`}>
  <div className="calendar-event-top"><span>{CALENDAR_KINDS[event.kind]}</span><span>{CALENDAR_STATUSES[event.status]}</span></div>
  <h3>{event.title}</h3><p><time dateTime={event.starts_at}>{calendarTime(event.starts_at)}</time><br/>ถึง {calendarTime(event.ends_at)}</p>
  {event.location&&<p>สถานที่: {event.location}</p>}{event.description&&<p className="calendar-description">{event.description}</p>}
  {event.participant_count!=null&&<p>ผู้เข้าร่วม {event.participant_count} คน</p>}
  {onEdit&&<button className="secondary-button" onClick={()=>onEdit(event)}>แก้ไขกำหนดการ</button>}
  {event.exam_id&&onExams&&event.status!=='cancelled'&&<button className="link-button" onClick={onExams}>ไปหน้าผลสอบ</button>}
 </article>;
}
export function UpcomingCalendar({userId,onOpenCalendar,onExams}) {
 const [state,setState]=useState({rows:[],loading:true,error:''});
 useEffect(()=>{ const controller=new AbortController();setState({rows:[],loading:true,error:''});
  const now=new Date();loadCalendar(now.toISOString(),new Date(now.getTime()+90*86400000).toISOString(),false,controller.signal)
   .then(rows=>{if(!controller.signal.aborted)setState({rows:rows.filter(x=>x.status!=='cancelled').slice(0,3),loading:false,error:''});})
   .catch(e=>{if(!controller.signal.aborted)setState({rows:[],loading:false,error:calendarError(e)});});return()=>controller.abort();
 },[userId]);
 return <section className="ms-card"><h2>กำหนดการใกล้ถึง</h2>{state.loading?<p role="status">กำลังโหลดกำหนดการ…</p>:state.error?<p className="form-error" role="alert">{state.error}</p>:state.rows.length?state.rows.map(e=><EventCard key={e.id} event={e} onExams={onExams}/>):<p>ยังไม่มีกิจกรรมที่ประกาศสำหรับคุณใน 90 วันข้างหน้า</p>}
 <button className="ms-link" onClick={onOpenCalendar}>ดูปฏิทินทั้งหมด →</button></section>;
}
export default function ResidentCalendar({user,onNavigate}) {
 const admin=user.role==='admin';const [month,setMonth]=useState(()=>bangkokInput(new Date()).slice(0,7));
 const [state,setState]=useState({rows:[],loading:true,error:''}),[reload,setReload]=useState(0),[editing,setEditing]=useState(null);
 const [notice,setNotice]=useState(''),[view,setView]=useState('month'),[selectedDay,setSelectedDay]=useState(()=>bangkokInput(new Date()).slice(0,10));
 const changeMonth=(next)=>{setMonth(next);setSelectedDay(next===bangkokInput(new Date()).slice(0,7)?bangkokInput(new Date()).slice(0,10):`${next}-01`);};
 useEffect(()=>{const controller=new AbortController();setState({rows:[],loading:true,error:''});
  const range=calendarRange(month);loadCalendar(range.from,range.to,admin,controller.signal).then(rows=>{if(!controller.signal.aborted)setState({rows,loading:false,error:''});}).catch(e=>{if(!controller.signal.aborted)setState({rows:[],loading:false,error:calendarError(e)});});
  return()=>controller.abort();},[month,admin,user.id,reload]);
 return <section className="resident-panel calendar-page"><div className="panel-title-row"><div><h2>ปฏิทินสอบและกิจกรรม</h2><p>เวลาไทย · กำหนดการแยกจากการประกาศผลสอบ</p></div>{admin&&<button className="primary-button" onClick={()=>{setNotice('');setEditing({id:crypto.randomUUID(),version:0});}}>เพิ่มกำหนดการ</button>}</div>
 <div className="calendar-toolbar"><div className="calendar-month-nav"><button type="button" className="secondary-button" aria-label="เดือนก่อนหน้า" disabled={month<='2000-01'} onClick={()=>changeMonth(shiftCalendarMonth(month,-1))}>‹</button><button type="button" className="secondary-button" onClick={()=>changeMonth(bangkokInput(new Date()).slice(0,7))}>วันนี้</button><button type="button" className="secondary-button" aria-label="เดือนถัดไป" disabled={month>='2100-12'} onClick={()=>changeMonth(shiftCalendarMonth(month,1))}>›</button></div><label>เดือน<input type="month" required value={month} min="2000-01" max="2100-12" onChange={e=>{if(e.target.value)changeMonth(e.target.value);}}/></label><button className="secondary-button" onClick={()=>setReload(x=>x+1)}>โหลดล่าสุด</button><div className="calendar-view-switch" role="group" aria-label="มุมมองกำหนดการ"><button type="button" className="secondary-button" aria-pressed={view==='month'} onClick={()=>setView('month')}>ปฏิทิน</button><button type="button" className="secondary-button" aria-pressed={view==='list'} onClick={()=>setView('list')}>รายการ</button></div></div>
 {notice&&<p className="form-success" role="status">{notice}</p>}{state.error&&<p className="form-error" role="alert">{state.error}</p>}
 {editing&&<CalendarEditor key={editing.id} event={editing} onClose={()=>setEditing(null)} onSaved={date=>{setEditing(null);setMonth(bangkokInput(date).slice(0,7));setSelectedDay(bangkokInput(date).slice(0,10));setNotice('บันทึกกำหนดการแล้ว');setReload(x=>x+1);}}/>}
 {state.loading?<p role="status">กำลังโหลด…</p>:!state.error&&<>
 {view==='month'&&<CalendarMonth month={month} events={state.rows} selected={selectedDay} onSelect={setSelectedDay}/>}
 <div className="calendar-day-details" aria-live="polite"><h3>{view==='month'?calendarDayLabel(selectedDay):`รายการเดือน ${calendarMonthLabel(month)}`}</h3>
 {(view==='month'?calendarEventsForDay(state.rows,selectedDay):state.rows).length===0?<p>{view==='month'?'ไม่มีกำหนดการในวันที่เลือก':'ยังไม่มีกำหนดการในเดือนนี้'}</p>:<div className="calendar-list">{(view==='month'?calendarEventsForDay(state.rows,selectedDay):state.rows).map(e=><EventCard key={e.id} event={e} onEdit={admin?setEditing:null} onExams={()=>onNavigate('exams')}/>)}</div>}</div>
 </>}

 </section>;
}
function CalendarMonth({month,events,selected,onSelect}) {
 const days=calendarMonthDays(month),today=bangkokInput(new Date()).slice(0,10);
 function move(event,day){const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(!(event.key in offsets))return;
  const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offsets[event.key]);const next=date.toISOString().slice(0,10);
  if(next.slice(0,7)!==month)return;event.preventDefault();onSelect(next);event.currentTarget.closest('table').querySelector(`[data-calendar-day="${next}"]`)?.focus();}
 return <div className="calendar-month"><h3>{calendarMonthLabel(month)}</h3><p className="calendar-grid-note">เลือกวันที่เพื่อดูรายละเอียด · กิจกรรมหลายวันแสดงในทุกวันที่เกี่ยวข้อง</p>
 <table className="calendar-month-table" aria-label={`ปฏิทิน ${calendarMonthLabel(month)}`}><thead><tr>{['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'].map(d=><th key={d} scope="col">{d}</th>)}</tr></thead><tbody>
 {Array.from({length:days.length/7},(_,week)=><tr key={week}>{days.slice(week*7,week*7+7).map((day,i)=>{const items=day?calendarEventsForDay(events,day):[];return <td key={day||`blank-${i}`} className={day?'':'calendar-outside'}>{day&&<button type="button" data-calendar-day={day} className="calendar-day-button" aria-label={`${calendarDayLabel(day)} · ${items.length} กิจกรรม`} aria-pressed={selected===day} aria-current={today===day?'date':undefined} onClick={()=>onSelect(day)} onKeyDown={e=>move(e,day)}>
 <span className="calendar-day-number">{Number(day.slice(-2))}</span>{items.length>0&&<><span className="calendar-day-count">{items.length}<span className="visually-hidden"> กิจกรรม</span></span><span className="calendar-cell-events" aria-hidden="true">{items.slice(0,2).map(e=><span key={e.id} className={`calendar-cell-event calendar-cell-${e.status}`}>{e.status==='cancelled'?'ยกเลิก · ':e.status==='draft'?'ร่าง · ':''}{e.title}</span>)}{items.length>2&&<span>อีก {items.length-2} รายการ</span>}</span></>}
 </button>}</td>;})}</tr>)}
 </tbody></table></div>;
}

function CalendarEditor({event,onClose,onSaved}) {
 const old=event.admin_payload;const [form,setForm]=useState(()=>old?{...old,starts_at:bangkokInput(old.starts_at),ends_at:bangkokInput(old.ends_at)}:{title:'',kind:'exam',starts_at:'',ends_at:'',location:'',description:'',status:'draft',audience_mode:'all',pgys:[],user_ids:[],exam_id:null});
 const [exams,setExams]=useState([]),[ready,setReady]=useState(false);
 const [people,setPeople]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);const flight=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;Promise.all([listAdminAccounts(),managedExamsApi.list()]).then(([rows,list])=>{if(live.current){setPeople(rows.filter(x=>x.active&&x.role==='resident'));setExams(list);setReady(true);setLoading(false);}}).catch(()=>{if(live.current){setError('โหลดรายชื่อไม่สำเร็จ กรุณาปิดแล้วเปิดใหม่');setLoading(false);}});return()=>{live.current=false;};},[]);
 const previewPeople=people.filter(p=>form.audience_mode==='all'||(form.audience_mode==='pgy'&&form.pgys.includes(p.pgy))||(form.audience_mode==='selected'&&form.user_ids.includes(p.user_id)));
 const audienceChanged=!old||JSON.stringify([form.audience_mode,form.pgys,form.user_ids])!==JSON.stringify([old.audience_mode,old.pgys,old.user_ids]);
 const set=(key,value)=>setForm(x=>({...x,[key]:value}));
 const toggle=(key,value)=>set(key,form[key].includes(value)?form[key].filter(x=>x!==value):[...form[key],value]);
 async function submit(e){e.preventDefault();if(flight.current)return;setError('');
  let payload;try{payload={...form,title:form.title.trim(),starts_at:bangkokIso(form.starts_at),ends_at:bangkokIso(form.ends_at)};
   if(payload.ends_at<=payload.starts_at)throw new Error('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
   if(form.status==='published'&&!window.confirm('ประกาศกำหนดการให้ผู้เข้าร่วมเห็น? ขั้นตอนนี้ไม่ประกาศคะแนนสอบ'))return;
  }catch(e){setError(e.message);return;}
  flight.current=true;setBusy(true);
  try{await saveCalendar(event.id,event.version,payload);if(live.current)onSaved(payload.starts_at);}catch(e){if(live.current)setError(calendarError(e));}finally{flight.current=false;if(live.current)setBusy(false);}
 }
 return <form className="calendar-editor" onSubmit={submit}><h3>{event.version?'แก้ไขกำหนดการ':'กำหนดการใหม่'}</h3><p>รายชื่อบันทึกเป็นชุด ณ เวลาจัดกิจกรรม ไม่เปลี่ยนตามการเลื่อนชั้นปี · หลังแก้กลุ่มเป้าหมาย ระบบจะจัดรายชื่อใหม่</p><fieldset disabled={busy||loading||!ready}>
 <label>ชื่อการสอบ / กิจกรรม<input required minLength={2} maxLength={160} value={form.title} onChange={e=>set('title',e.target.value)}/></label>
 <div className="calendar-fields"><label>ประเภท<select value={form.kind} onChange={e=>setForm(x=>({...x,kind:e.target.value,exam_id:e.target.value==='exam'?x.exam_id:null}))}>{Object.entries(CALENDAR_KINDS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>สถานะ<select aria-label="สถานะ" value={form.status} onChange={e=>set('status',e.target.value)}>{Object.entries(CALENDAR_STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>เริ่ม (เวลาไทย)<input required type="datetime-local" value={form.starts_at} onChange={e=>set('starts_at',e.target.value)}/></label><label>สิ้นสุด (เวลาไทย)<input required type="datetime-local" value={form.ends_at} onChange={e=>set('ends_at',e.target.value)}/></label></div>
 {form.kind==='exam'&&<label>เชื่อมรายการสอบ (ไม่บังคับ)<select value={form.exam_id||''} onChange={e=>set('exam_id',e.target.value||null)}><option value="">ยังไม่เชื่อมรายการสอบ</option>{exams.map(e=><option key={e.exam_id} value={e.exam_id}>{(e.working||e.published)?.academic_year} · {(e.working||e.published)?.title}</option>)}</select><small>ผู้เข้าร่วมเห็นทางไปผลสอบเมื่อประกาศคะแนนแล้วเท่านั้น</small></label>}
 <label>สถานที่<input maxLength={200} value={form.location} onChange={e=>set('location',e.target.value)}/></label><label>รายละเอียด<textarea maxLength={2000} rows={3} value={form.description} onChange={e=>set('description',e.target.value)}/></label>
 <label>ผู้เข้าร่วม<select aria-label="ผู้เข้าร่วม" value={form.audience_mode} onChange={e=>setForm(x=>({...x,audience_mode:e.target.value,pgys:[],user_ids:[]}))}><option value="all">Resident ทุกคนที่ใช้งานอยู่</option><option value="pgy">เลือกชั้นปี</option><option value="selected">เลือกเป็นรายบุคคล</option></select></label>
 {form.audience_mode==='pgy'&&<div className="calendar-choices">{[1,2,3,4,5].map(p=><label key={p}><input type="checkbox" checked={form.pgys.includes(p)} onChange={()=>toggle('pgys',p)}/>PGY {p}</label>)}</div>}
 {form.audience_mode==='selected'&&<div className="calendar-choices">{people.map(p=><label key={p.user_id}><input type="checkbox" checked={form.user_ids.includes(p.user_id)} onChange={()=>toggle('user_ids',p.user_id)}/>{p.full_name} · PGY {p.pgy||'—'}</label>)}</div>}
 <details><summary>{audienceChanged?`ตรวจรายชื่อเป้าหมายปัจจุบัน (${previewPeople.length} คน)`:`รายชื่อที่บันทึกไว้ (${event.participant_count} คน)`}</summary><ul>{audienceChanged?previewPeople.map(p=><li key={p.user_id}>{p.full_name} · PGY {p.pgy||'—'}</li>):(event.participants||[]).map(p=><li key={p.user_id}>{people.find(x=>x.user_id===p.user_id)?.full_name||'บัญชีที่ไม่อยู่ในรายชื่อใช้งานปัจจุบัน'} · PGY ณ จัดกิจกรรม {p.pgy_at_schedule||'—'}</li>)}</ul></details>
 {old&&<p>รายชื่อชุดปัจจุบัน {event.participant_count} คน · เปลี่ยนเวลา/สถานที่อย่างเดียวจะคงรายชื่อเดิม</p>}
 <p>หากปิดหน้าหรือขาดการเชื่อมต่อขณะบันทึก ให้โหลดล่าสุดและตรวจรายการก่อนเพิ่มใหม่</p>
 <div className="button-row"><button className="primary-button" type="submit">{busy?'กำลังบันทึก…':'บันทึกกำหนดการ'}</button><button className="secondary-button" type="button" onClick={onClose}>ปิด</button></div></fieldset>{error&&<p className="form-error" role="alert">{error}</p>}</form>;
}
