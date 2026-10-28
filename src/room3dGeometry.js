// Approved room v3: visual furniture/seat positions only; IDs/counts and database stay unchanged.
import { ROOM_3D, seatPosition } from './seatMap3d.js';
export const DRAFT_CHAIR = Object.freeze({width:.52,depth:.42,height:.83});
export const DRAFT_DESK = Object.freeze({depth:.30,frontOffset:.45,height:.70});
export function buildRoomGeometry(seats) {
 const chairs=seats.map(seat=>{
  const base=seatPosition(seat);const p=base?{...base}:null;if(!p)throw new Error(`Unknown seat ${seat.seat_code}`);
  // Fill the circled rear gaps without adding rows or seats.
  if(seat.zone==='L')p.z=.35+(seat.row_no-1)*(6.7-.35)/4;
  if(seat.zone==='R')p.z=.35+(seat.row_no-1)*(6.7-.35)/3;
  if(seat.zone==='M'){p.x=ROOM_3D.width-1.3+(seat.col_no===1?-.45:.45);p.z=-2.2;}
  if(seat.zone==='H')p.z=ROOM_3D.table.z+ROOM_3D.table.d+DRAFT_DESK.frontOffset+DRAFT_DESK.depth/2;
  const facing=seat.zone==='M'?{x:0,z:1}:seat.zone==='C'?{x:seat.col_no===1?1:-1,z:0}:{x:0,z:-1};
  const angle=Math.atan2(-facing.x,-facing.z);
  const width=facing.x?DRAFT_CHAIR.depth:DRAFT_CHAIR.width,depth=facing.x?DRAFT_CHAIR.width:DRAFT_CHAIR.depth;
  return {...seat,...p,facing,angle,bounds:{minX:p.x-width/2,maxX:p.x+width/2,minZ:p.z-depth/2,maxZ:p.z+depth/2}};
 });
 const t=ROOM_3D.table;
 const desks=[{id:'centre-table-1',kind:'central',x:t.x,z:t.z,w:t.w/2,d:t.d,h:.70},{id:'centre-table-2',kind:'central',x:t.x+t.w/2,z:t.z,w:t.w/2,d:t.d,h:.70}];
 for(const zone of ['M','L','R','H','S','B']){
  const rows=[...new Set(chairs.filter(s=>s.zone===zone).map(s=>s.row_no))];
  for(const row of rows){const rowSeats=chairs.filter(s=>s.zone===zone&&s.row_no===row).sort((a,b)=>a.col_no-b.col_no);let segment=[];
   const add=()=>{if(!segment.length)return;const first=segment[0],last=segment.at(-1),forward=first.facing.z;
    desks.push({id:`desk-${zone}-${row}-${first.col_no}`,kind:zone==='M'?'moderator':zone==='S'||zone==='B'?'rear':'row',x:first.x-.33,z:first.z+forward*DRAFT_DESK.frontOffset-DRAFT_DESK.depth/2,w:last.x-first.x+.66,d:DRAFT_DESK.depth,h:.70,zone,row,seatCodes:segment.map(s=>s.seat_code)});segment=[];};
   for(const s of rowSeats){if(segment.length&&s.col_no-segment.at(-1).col_no>1)add();segment.push(s);}add();
  }
 }
 return {chairs,desks,room:ROOM_3D,assumption:'Draft v3 visual positions follow Sense annotations; 64 seat IDs/counts unchanged; no database writes.'};
}
export function furnitureOverlaps(geometry) {
 const overlaps=[];const eps=1e-6;
 for(const c of geometry.chairs)for(const d of geometry.desks){const b=c.bounds;if(b.minX<d.x+d.w-eps&&b.maxX>d.x+eps&&b.minZ<d.z+d.d-eps&&b.maxZ>d.z+eps)overlaps.push(`${c.seat_code}/${d.id}`);}
 return overlaps;
}

export const roomGeometryKey = map => JSON.stringify((map?.seats || []).map(s => [s.seat_code,s.zone,s.row_no,s.col_no]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
// Kept as a pure helper alias for preview/geometry regression consumers.
export const buildDraftRoomGeometry = buildRoomGeometry;
