begin;
-- New versioned room: never reshape seats referenced by historical rounds.
alter table public.resident_room_seats drop constraint resident_room_seats_seat_code_check;
alter table public.resident_room_seats add constraint resident_room_seats_seat_code_check check (seat_code ~ '^[MLCRHSB][0-9]{1,2}$');
alter table public.resident_room_seats drop constraint resident_room_seats_zone_check;
alter table public.resident_room_seats add constraint resident_room_seats_zone_check check (zone in ('M','L','C','R','H','S','B'));
alter table public.resident_seat_assignments drop constraint resident_seat_assignments_seat_code_check;
alter table public.resident_seat_assignments add constraint resident_seat_assignments_seat_code_check check (seat_code ~ '^[MLCRHSB][0-9]{1,2}$');
alter table public.resident_seat_holds drop constraint resident_seat_holds_seat_code_check;
alter table public.resident_seat_holds add constraint resident_seat_holds_seat_code_check check (seat_code ~ '^[MLCRHSB][0-9]{1,2}$');
insert into public.resident_room_layouts(name) values ('ห้องประชุมจริง · 64 ที่ (2569-10)');
insert into public.resident_room_seats(layout_id,seat_code,zone,row_no,col_no)
select l.id,v.code,v.zone,v.r,v.c from public.resident_room_layouts l cross join lateral (
 select 'M'||n as code,'M' as zone,1 as r,n as c from generate_series(1,2) n
 union all select 'L'||n,'L',case when n<=2 then 1 else (n-3)/3+2 end,case when n<=2 then n else (n-3)%3+1 end from generate_series(1,14) n
 union all select 'C'||n,'C',(n+1)/2,case when n%2=1 then 1 else 2 end from generate_series(1,12) n
 union all select 'R'||n,'R',case when n<=2 then 1 else (n-3)/3+2 end,case when n<=2 then n+1 else (n-3)%3+1 end from generate_series(1,11) n
 union all select 'H'||n,'H',1,n from generate_series(1,2) n
 union all select 'S'||n,'S',1,case when n<=4 then n else n+2 end from generate_series(1,7) n
 union all select 'S'||(n+7),'S',2,case when n<=5 then n else n+1 end from generate_series(1,8) n
 union all select 'B'||n,'B',1,n from generate_series(1,8) n
) v where l.name='ห้องประชุมจริง · 64 ที่ (2569-10)';
-- Legacy layouts remain in place for historical readers; no seats are deleted.
update public.resident_room_layouts set active=false where name like 'ห้องประชุมวันศุกร์%';

create or replace function public.hold_resident_seat(p_session_id uuid, p_seat_code text)
returns timestamptz language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_exp timestamptz;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role not in ('resident','staff') then raise exception 'Active Resident or Staff account required'; end if;
  if not exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id and a.user_id = c.user_id) then
    raise exception 'Scan the room QR before choosing a seat';
  end if;
  if not exists (select 1 from public.resident_room_seats s where s.layout_id = c.layout_id and s.seat_code = p_seat_code) then
    raise exception 'Seat does not exist';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_seat_code, 0));
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.expires_at <= c.now_ts;
  if exists (select 1 from public.resident_seat_assignments a where a.session_id = p_session_id and a.seat_code = p_seat_code and a.released_at is null)
     or exists (select 1 from public.resident_seat_holds h where h.session_id = p_session_id and h.seat_code = p_seat_code and h.user_id <> c.user_id) then
    raise exception 'Seat is not available';
  end if;
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.user_id = c.user_id;
  insert into public.resident_seat_holds(session_id, seat_code, user_id, expires_at)
  values (p_session_id, p_seat_code, c.user_id, c.now_ts + interval '60 seconds')
  returning expires_at into v_exp;
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, 'hold', p_seat_code, '{}'::jsonb);
  return v_exp;
end;
$$;
revoke all on function public.hold_resident_seat(uuid, text) from public, anon;
grant execute on function public.hold_resident_seat(uuid, text) to authenticated;

create or replace function public.confirm_resident_seat(p_session_id uuid, p_seat_code text)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_old text;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role not in ('resident','staff') then raise exception 'Active Resident or Staff account required'; end if;
  if not exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id and a.user_id = c.user_id) then
    raise exception 'Scan the room QR before choosing a seat';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_seat_code, 0));
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.expires_at <= c.now_ts;
  if not exists (select 1 from public.resident_seat_holds h where h.session_id = p_session_id and h.seat_code = p_seat_code and h.user_id = c.user_id) then
    raise exception 'Seat hold expired. Choose the seat again';
  end if;
  if exists (select 1 from public.resident_seat_assignments a where a.session_id = p_session_id and a.seat_code = p_seat_code and a.released_at is null) then
    raise exception 'Seat is not available';
  end if;
  begin
    update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'moved'
    where a.session_id = p_session_id and a.user_id = c.user_id and a.released_at is null
    returning a.seat_code into v_old;
    insert into public.resident_seat_assignments(session_id, user_id, seat_code, seated_at, assigned_by)
    values (p_session_id, c.user_id, p_seat_code, c.now_ts, c.user_id);
  exception when unique_violation then
    raise exception 'Seat is not available';
  end;
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.user_id = c.user_id;
  delete from public.resident_seat_status s where s.session_id = p_session_id and s.user_id = c.user_id;
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, case when v_old is null then 'confirm' else 'move' end, p_seat_code,
    case when v_old is null then '{}'::jsonb else jsonb_build_object('from', v_old) end);
end;
$$;
revoke all on function public.confirm_resident_seat(uuid, text) from public, anon;
grant execute on function public.confirm_resident_seat(uuid, text) to authenticated;

create or replace function public.release_resident_seat(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_seat text;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role not in ('resident','staff') then raise exception 'Active Resident or Staff account required'; end if;
  update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'self'
  where a.session_id = p_session_id and a.user_id = c.user_id and a.released_at is null
  returning a.seat_code into v_seat;
  if v_seat is null then raise exception 'You do not have a seat'; end if;
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, 'release', v_seat, '{}'::jsonb);
end;
$$;
revoke all on function public.release_resident_seat(uuid) from public, anon;
grant execute on function public.release_resident_seat(uuid) to authenticated;

create or replace function public.use_reserve_area(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  c record;
  v_seat text;
begin
  select * into c from private.resident_seat_context(p_session_id, 'live');
  if c.role not in ('resident','staff') then raise exception 'Active Resident or Staff account required'; end if;
  if not exists (select 1 from public.resident_round_attendance a where a.session_id = p_session_id and a.user_id = c.user_id) then
    raise exception 'Scan the room QR before choosing a seat';
  end if;
  if exists (select 1 from public.resident_seat_status s where s.session_id = p_session_id and s.user_id = c.user_id) then
    raise exception 'Already in the reserve area';
  end if;
  update public.resident_seat_assignments a set released_at = c.now_ts, release_reason = 'reserve'
  where a.session_id = p_session_id and a.user_id = c.user_id and a.released_at is null
  returning a.seat_code into v_seat;
  delete from public.resident_seat_holds h where h.session_id = p_session_id and h.user_id = c.user_id;
  insert into public.resident_seat_status(session_id, user_id, status) values (p_session_id, c.user_id, 'reserve');
  perform private.resident_seat_log(p_session_id, c.user_id, c.user_id, 'reserve', v_seat,
    case when v_seat is null then '{}'::jsonb else jsonb_build_object('from', v_seat) end);
end;
$$;
revoke all on function public.use_reserve_area(uuid) from public, anon;
grant execute on function public.use_reserve_area(uuid) to authenticated;

create or replace function public.admin_configure_seat_session(p_session_id uuid, p_layout_id uuid default null, p_on_time_at timestamptz default null)
returns table (session_id uuid, layout_id uuid, on_time_at timestamptz)
language plpgsql security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_s record;
  v_prev record;
  v_exist record;
  v_layout uuid;
  v_on timestamptz;
begin
  if not (select private.resident_can_configure_seat_map()) then raise exception 'Active Admin account required'; end if;
  select s.id, s.starts_at, s.ends_at into v_s
  from public.resident_round_sessions s where s.id = p_session_id and s.cancelled_at is null and s.closed_at is null;
  if v_s.id is null then raise exception 'Session not found, cancelled or closed'; end if;
  select cfg.layout_id, cfg.on_time_at into v_prev
  from public.resident_round_seat_config cfg join public.resident_round_sessions s2 on s2.id = cfg.session_id
  where cfg.session_id <> p_session_id and s2.starts_at < v_s.starts_at
    and exists (select 1 from public.resident_room_layouts l where l.id=cfg.layout_id and l.active)
  order by s2.starts_at desc limit 1;
  select cfg.layout_id, cfg.on_time_at into v_exist from public.resident_round_seat_config cfg where cfg.session_id = p_session_id;
  v_layout := coalesce(p_layout_id, v_exist.layout_id, v_prev.layout_id,
                       (select l.id from public.resident_room_layouts l where l.active order by l.name limit 1));
  if v_layout is null or not exists (select 1 from public.resident_room_layouts l where l.id = v_layout and (l.active or l.id = v_exist.layout_id)) then
    raise exception 'Layout not found';
  end if;
  if p_on_time_at is not null then
    if p_on_time_at < v_s.starts_at or p_on_time_at > v_s.ends_at then raise exception 'On-time must be inside the session window'; end if;
    v_on := p_on_time_at;
  elsif v_exist.on_time_at is not null then
    v_on := v_exist.on_time_at;
  else
    v_on := case when v_prev.on_time_at is null then null else
      ((v_s.starts_at at time zone 'Asia/Bangkok')::date + (v_prev.on_time_at at time zone 'Asia/Bangkok')::time) at time zone 'Asia/Bangkok' end;
    if v_on is null or v_on < v_s.starts_at or v_on > v_s.ends_at then v_on := least(v_s.starts_at + interval '15 minutes', v_s.ends_at); end if;
  end if;
  if v_exist.layout_id is not null then
    if v_exist.layout_id <> v_layout and (
         exists (select 1 from public.resident_seat_assignments a where a.session_id = p_session_id)
         or exists (select 1 from public.resident_seat_holds h where h.session_id = p_session_id)) then
      raise exception 'Layout cannot change after seating started';
    end if;
    update public.resident_round_seat_config cfg set layout_id = v_layout, on_time_at = v_on where cfg.session_id = p_session_id;
  else
    insert into public.resident_round_seat_config(session_id, layout_id, on_time_at, created_by) values (p_session_id, v_layout, v_on, v_uid);
  end if;
  perform private.resident_seat_log(p_session_id, v_uid, null, 'configure', null, jsonb_build_object('layout_id', v_layout, 'on_time_at', v_on));
  return query select p_session_id, v_layout, v_on;
end;
$$;
revoke all on function public.admin_configure_seat_session(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.admin_configure_seat_session(uuid, uuid, timestamptz) to authenticated;

-- Only unused future rounds more than one hour away adopt the new layout.
-- Live/near-live/history/rounds with any attendance or seating evidence are preserved.
do $$ declare v record; v_new uuid;
begin
 select id into strict v_new from public.resident_room_layouts where name='ห้องประชุมจริง · 64 ที่ (2569-10)';
 for v in select c.session_id,c.layout_id,c.created_by from public.resident_round_seat_config c
 join public.resident_round_sessions s on s.id=c.session_id
 join public.resident_room_layouts l on l.id=c.layout_id
 where l.name like 'ห้องประชุมวันศุกร์%' and s.starts_at>clock_timestamp()+interval '1 hour'
 and s.closed_at is null and s.cancelled_at is null
 and not exists(select 1 from public.resident_round_attendance a where a.session_id=s.id)
 and not exists(select 1 from public.resident_seat_assignments a where a.session_id=s.id)
 and not exists(select 1 from public.resident_seat_holds h where h.session_id=s.id)
 and not exists(select 1 from public.resident_seat_status st where st.session_id=s.id)
 and not exists(select 1 from public.resident_seat_requests q where q.session_id=s.id)
 for update of c loop
   update public.resident_round_seat_config set layout_id=v_new where session_id=v.session_id;
   perform private.resident_seat_log(v.session_id,v.created_by,null,'configure',null,jsonb_build_object('source','real_room_64_migration','previous_layout_id',v.layout_id,'layout_id',v_new));
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
