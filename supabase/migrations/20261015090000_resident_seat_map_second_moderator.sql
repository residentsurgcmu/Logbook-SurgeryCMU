-- Seat map follow-up: the front of the room has TWO moderator seats (M1, M2). Neither has to be filled at any meeting:
-- the map has never required a full room, so an empty M2 (or M1) is simply a free seat. Additive and idempotent.
--   * adds seat M2 (zone M, row 1, column 2) to the Friday layout, wherever it is already named (37 or 38)
--   * renames that layout "(37 ที่)" -> "(38 ที่)" so the name matches (only when the new name is not taken)
-- Nothing else changes: assignments, holds, events and all functions are untouched. Seat configs made earlier keep working
-- (they point at the layout id, not its name).
insert into public.resident_room_seats(layout_id, seat_code, zone, row_no, col_no)
select l.id, 'M2', 'M', 1, 2
from public.resident_room_layouts l
where l.name in ('ห้องประชุมวันศุกร์ (37 ที่)', 'ห้องประชุมวันศุกร์ (38 ที่)')
on conflict (layout_id, seat_code) do nothing;

update public.resident_room_layouts
set name = 'ห้องประชุมวันศุกร์ (38 ที่)'
where name = 'ห้องประชุมวันศุกร์ (37 ที่)'
  and not exists (select 1 from public.resident_room_layouts where name = 'ห้องประชุมวันศุกร์ (38 ที่)');
