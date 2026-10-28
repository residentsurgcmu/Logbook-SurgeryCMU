import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import test from 'node:test';
import {seatPosition,ROOM_3D} from '../src/seatMap3d.js';import {canPickSeat,sessionPhase} from '../src/seatMap.js';
const seats=JSON.parse(await readFile(new URL('./real-room-64-fixture.json',import.meta.url)));
test('provided physical room has exactly 64 chairs in seven zones and no shared coordinates',()=>{
 assert.equal(seats.length,64);assert.equal(new Set(seats.map(s=>s.seat_code)).size,64);
 const counts=Object.fromEntries(['M','L','C','R','H','S','B'].map(z=>[z,seats.filter(s=>s.zone===z).length]));assert.deepEqual(counts,{M:2,L:14,C:12,R:11,H:2,S:15,B:8});
 const positions=seats.map(seatPosition);assert.ok(positions.every(Boolean));assert.equal(new Set(positions.map(p=>`${p.x}/${p.z}`)).size,64);
 for(let i=0;i<positions.length;i++){const p=positions[i];assert.ok(p.x>0&&p.x<ROOM_3D.width&&p.z<ROOM_3D.depth);for(let j=0;j<i;j++)assert.ok(Math.hypot(p.x-positions[j].x,p.z-positions[j].z)>=ROOM_3D.seat,'chairs must not overlap');}
 assert.equal(seats.find(s=>s.seat_code==='R1').col_no,2);
 const z=zone=>Math.min(...seats.filter(s=>s.zone===zone).map(s=>seatPosition(s).z));assert.ok(z('M')<z('L'));assert.ok(z('H')>z('C')&&z('S')>z('H')&&z('B')>z('S'));
});
test('Staff self seating requires QR and live round, and seated staff can release their own seat',()=>{
 const map={session:{open:true,ended:false},me:{role:'staff',in_room:true,seat:null}};
 assert.equal(canPickSeat(map),true);assert.equal(sessionPhase(map),'pick');
 assert.equal(canPickSeat({...map,me:{...map.me,in_room:false}}),false);
 assert.equal(canPickSeat({...map,session:{open:false,ended:true}}),false);
 assert.equal(sessionPhase({...map,me:{...map.me,seat:'H1'}}),'seated');
});
