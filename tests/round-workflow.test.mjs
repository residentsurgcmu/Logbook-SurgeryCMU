import test from 'node:test';
import assert from 'node:assert/strict';
import {roundSchedulePayload,roundArrivalLabel,roundSessionStatus} from '../src/roundSchedule.js';
test('default meeting creates one shared scan window; a special window is explicit',()=>{
 assert.deepEqual(roundSchedulePayload({start:'09:00',end:'12:00'}),{start:'09:00',end:'12:00',activityStart:'09:00',activityEnd:'12:00',enableSeats:true});
 assert.deepEqual(roundSchedulePayload({start:'09:00',end:'12:00',customScan:true,scanStart:'08:30',scanEnd:'12:00',enableSeats:false}),{start:'08:30',end:'12:00',activityStart:'09:00',activityEnd:'12:00',enableSeats:false});
});
test('lateness is elapsed from activity start, not a scan deadline',()=>{
 const s={meeting_date:'2026-10-28',starts_at:'2026-10-28T08:30:00+07:00',ends_at:'2026-10-28T12:00:00+07:00',activity_start_time:'09:00:00'};
 assert.equal(roundArrivalLabel(s,'2026-10-28T09:17:00+07:00'),'สาย 17 นาที');
 assert.equal(roundArrivalLabel(s,'2026-10-28T08:59:00+07:00'),'ก่อนเริ่มประชุม');
 assert.equal(roundArrivalLabel(s,'2026-10-28T09:00:00+07:00'),'ตรงเวลา');
 assert.equal(roundArrivalLabel(s,'2026-10-28T09:00:20+07:00'),'สายไม่ถึง 1 นาที');
 assert.equal(roundSessionStatus(s,Date.parse('2026-10-28T11:59:00+07:00')),'live');
 assert.equal(roundSessionStatus(s,Date.parse('2026-10-28T12:00:01+07:00')),'ended');
});
