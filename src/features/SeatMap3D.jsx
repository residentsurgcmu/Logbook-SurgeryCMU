import React,{useEffect,useRef,useState} from 'react';
import LegacySeatMap3D from './SeatMap3DLegacy';
import {seatCell} from '../seatMap';
import {mountRoom3d,ROOM_STATUS_SYMBOLS} from '../room3dScene';
import {seatSummary,summaryText} from '../seatMap3d';

const COUNTS={M:2,L:14,C:12,R:11,H:2,S:15,B:8};
export function isApprovedRoom64(seats=[]) {
 if(seats.length!==64||new Set(seats.map(s=>s.seat_code)).size!==64)return false;
 return Object.entries(COUNTS).every(([z,n])=>seats.filter(s=>s.zone===z).length===n);
}
export default function SeatMap3D(props) {
 const {map}=props;
 // Reset all detail/renderer state on account, session, layout or geometry change.
 const key=JSON.stringify([map?.me?.user_id,map?.me?.role,map?.session?.id,map?.session?.layout_id,(map?.seats||[]).map(s=>[s.seat_code,s.zone,s.row_no,s.col_no])]);
 return isApprovedRoom64(map?.seats)?<ApprovedRoom key={key} {...props}/>:<LegacySeatMap3D key={key} {...props}/>;
}
function ApprovedRoom({map,paused=false,onUnavailable}) {
 const stage=useRef(null),view=useRef(null),latest=useRef(map),pause=useRef(paused),unavailable=useRef(onUnavailable);
 const [seat,setSeat]=useState(null),[preset,setPreset]=useState('oblique');
 latest.current=map;pause.current=paused;unavailable.current=onUnavailable;
 useEffect(()=>{
  let live=true,room;
  try{room=mountRoom3d(stage.current,latest.current,{paused:pause.current,onSeat:s=>{if(live)setSeat(s);},onError:()=>{if(live)unavailable.current?.();}});view.current=room;}
  catch{unavailable.current?.();}
  return()=>{live=false;view.current=null;room?.dispose();};
 },[]);
 useEffect(()=>{view.current?.syncMap(map);},[map]);
 useEffect(()=>{view.current?.setPaused(paused);},[paused]);
 const choose=id=>{setPreset(id);view.current?.setPreset(id);};
 return <div className="seatmap3d">
  <div className="seatmap3d-presets" role="group" aria-label="มุมมองผัง 3D">{[['oblique','มุมเฉียง'],['top','มุมบน'],['front','จากหน้าห้อง'],['back','จากหลังห้อง']].map(([id,label])=><button type="button" key={id} aria-pressed={preset===id} onClick={()=>choose(id)}>{label}</button>)}<button type="button" onClick={()=>choose('oblique')}>รีเซ็ตมุมมอง</button><button type="button" aria-label="ซูมเข้า" onClick={()=>view.current?.zoom(.83)}>+</button><button type="button" aria-label="ซูมออก" onClick={()=>view.current?.zoom(1.2)}>−</button></div>
  <p className="seatmap-hint">○ ว่าง · ● มีผู้นั่ง · ★ ที่นั่งของคุณ · ◇ คุณกำลังถือ · … ผู้อื่นกำลังยืนยัน</p>
  <div className="seatmap3d-stage" ref={stage}/>
  <div className="seatmap3d-detail"><label>ดูข้อมูลที่นั่ง<select aria-label="ดูข้อมูลที่นั่ง" value={seat?.seat_code||''} onChange={e=>view.current?.select(e.target.value)}><option value="">เลือกที่นั่งเพื่อดูข้อมูล</option>{map.seats.map(s=><option key={s.seat_code} value={s.seat_code}>{ROOM_STATUS_SYMBOLS[seatCell(s,map).state]} {s.seat_code} · {seatCell(s,map).label}</option>)}</select></label><p role="status">{seat?.ariaLabel||'แตะเก้าอี้เพื่อดูชื่อและสถานะ'}</p></div>
  <p className="seatmap-hint" role="status">{summaryText(seatSummary(map))}</p><p className="seatmap-hint">ลากเพื่อหมุน · ซูมด้วยล้อเมาส์หรือสองนิ้ว · แตะที่นั่งเพื่อดูสถานะ · เลือกที่นั่งในผัง 2D</p>
 </div>;
}
