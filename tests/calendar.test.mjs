import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarRange,bangkokInput,bangkokIso} from '../src/calendarRules.js';
test('calendar month boundaries use Bangkok, including December rollover',()=>{
 assert.deepEqual(calendarRange('2026-12'),{from:'2026-11-30T17:00:00.000Z',to:'2026-12-31T17:00:00.000Z'});
 assert.equal(calendarRange('2028-02').to,'2028-02-29T17:00:00.000Z');
 assert.throws(()=>calendarRange('2026-13'));
});
test('calendar time roundtrip rejects impossible or incomplete dates',()=>{
 assert.equal(bangkokInput(bangkokIso('2026-10-28T09:00')),'2026-10-28T09:00');
 assert.equal(bangkokIso('2026-10-28T09:00'),'2026-10-28T02:00:00.000Z');
 assert.throws(()=>bangkokIso('2026-02-30T10:00'));assert.throws(()=>bangkokIso('2026-10-28'));
});

import {calendarMonthDays,calendarEventsForDay,shiftCalendarMonth} from '../src/calendarRules.js';
test('calendar grid aligns weekdays, leap days, blanks and December navigation',()=>{
 const d=calendarMonthDays('2026-10');assert.equal(d.length,35);assert.equal(d[4],'2026-10-01');assert.equal(d[34],'2026-10-31');assert.equal(d[0],null);
 assert.ok(calendarMonthDays('2028-02').includes('2028-02-29'));assert.ok(!calendarMonthDays('2027-02').includes('2027-02-29'));
 assert.equal(shiftCalendarMonth('2026-12',1),'2027-01');assert.equal(shiftCalendarMonth('2027-01',-1),'2026-12');
});
test('day membership uses Bangkok overlap, midnight end exclusive and multi-day spans',()=>{
 const e=[{id:'overnight',starts_at:'2026-10-01T16:30:00Z',ends_at:'2026-10-02T01:00:00Z'},{id:'midnight',starts_at:'2026-10-01T01:00:00Z',ends_at:'2026-10-01T17:00:00Z'}];
 assert.deepEqual(calendarEventsForDay(e,'2026-10-01').map(e=>e.id),['overnight','midnight']);assert.deepEqual(calendarEventsForDay(e,'2026-10-02').map(e=>e.id),['overnight']);assert.deepEqual(calendarEventsForDay(e,'2026-10-03'),[]);
});
