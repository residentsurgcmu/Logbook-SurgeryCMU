begin;
-- Additive entry points: old clients and historical sessions keep their behavior.
create function public.schedule_resident_round(
 p_meeting_date date, p_start_time time, p_end_time time,
 p_activity_start time default null, p_activity_end time default null,
 p_enable_seats boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_on timestamptz;
begin
 if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
 if p_enable_seats is null then raise exception 'Seat preference is required'; end if;
 v_id := public.open_resident_round(p_meeting_date,p_start_time,p_end_time,p_activity_start,p_activity_end);
 if p_enable_seats then
   v_on := (p_meeting_date + coalesce(p_activity_start,p_start_time)) at time zone 'Asia/Bangkok';
   -- A special scan window may start after the activity; the first accepted scan is then late.
   v_on := greatest((p_meeting_date+p_start_time) at time zone 'Asia/Bangkok',least(v_on,(p_meeting_date+p_end_time) at time zone 'Asia/Bangkok'));
   perform public.admin_configure_seat_session(v_id,null,v_on);
 end if;
 return v_id;
end $$;
revoke all on function public.schedule_resident_round(date,time,time,time,time,boolean) from public,anon;
grant execute on function public.schedule_resident_round(date,time,time,time,time,boolean) to authenticated;

create function public.reschedule_resident_round(
 p_session_id uuid, p_meeting_date date, p_start_time time, p_end_time time,
 p_activity_start time default null, p_activity_end time default null,
 p_enable_seats boolean default true
) returns void language plpgsql security definer set search_path = '' as $$
declare v_old record; v_on timestamptz; v_existing timestamptz;
begin
 if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
 if p_enable_seats is null then raise exception 'Seat preference is required'; end if;
 select * into v_old from public.resident_round_sessions where id=p_session_id for update;
 if v_old.id is null then raise exception 'Session not found'; end if;
 select on_time_at into v_existing from public.resident_round_seat_config where session_id=p_session_id;
 if not p_enable_seats and v_existing is not null then raise exception 'Cannot disable an existing seat map'; end if;
 perform public.update_resident_round_session(p_session_id,p_meeting_date,p_start_time,p_end_time,p_activity_start,p_activity_end);
 if p_enable_seats then
   -- Preserve an explicitly customized cutoff when moving the schedule, unless it no longer fits.
   v_on := case when v_existing is null or v_existing = coalesce((v_old.meeting_date+v_old.activity_start_time) at time zone 'Asia/Bangkok',v_old.starts_at) then (p_meeting_date+coalesce(p_activity_start,p_start_time)) at time zone 'Asia/Bangkok'
     else v_existing + (((p_meeting_date+p_start_time) at time zone 'Asia/Bangkok') - v_old.starts_at) end;
   v_on := greatest((p_meeting_date+p_start_time) at time zone 'Asia/Bangkok',least(v_on,(p_meeting_date+p_end_time) at time zone 'Asia/Bangkok'));
   perform public.admin_configure_seat_session(p_session_id,null,v_on);
 end if;
end $$;
revoke all on function public.reschedule_resident_round(uuid,date,time,time,time,time,boolean) from public,anon;
grant execute on function public.reschedule_resident_round(uuid,date,time,time,time,time,boolean) to authenticated;

-- Forgotten scans are explicit Admin evidence, never manufactured QR scans.
create table public.resident_round_attendance_adjustments (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.resident_round_sessions(id),
 user_id uuid not null references public.resident_profiles(user_id),
 actor_id uuid not null references public.resident_profiles(user_id),
 recorded_at timestamptz not null default clock_timestamp(),
 checked_in_at timestamptz not null,
 reason text not null check (char_length(btrim(reason)) between 5 and 300),
 unique(session_id,user_id),
 foreign key(session_id,user_id) references public.resident_round_attendance(session_id,user_id)
);
alter table public.resident_round_attendance_adjustments enable row level security;
revoke all on public.resident_round_attendance_adjustments from public,anon,authenticated,service_role;
grant select on public.resident_round_attendance_adjustments to authenticated;
create policy round_adjustments_admin_read on public.resident_round_attendance_adjustments for select to authenticated
 using (private.resident_role_is('admin'));
create function public.admin_record_missing_round_attendance(p_session_id uuid,p_user_id uuid,p_checked_in_at timestamptz,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s record; v_role public.resident_system_role; v_from timestamptz; v_to timestamptz;
begin
 if not private.resident_role_is('admin') then raise exception 'Active Admin account required'; end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 5 and 300 then raise exception 'Reason must be 5-300 characters'; end if;
 select r.role into v_role from public.resident_user_roles r join public.resident_profiles p on p.user_id=r.user_id
 where r.user_id=p_user_id and r.active and p.active and r.role in ('resident','staff') for share of r,p;
 if v_role is null then raise exception 'Active Resident or Staff account required'; end if;
 select * into v_s from public.resident_round_sessions where id=p_session_id for update;
 if v_s.id is null or v_s.cancelled_at is not null then raise exception 'Session not found or cancelled'; end if;
 v_from := coalesce((v_s.meeting_date+v_s.activity_start_time) at time zone 'Asia/Bangkok',v_s.starts_at);
 v_to := least(coalesce((v_s.meeting_date+v_s.activity_end_time) at time zone 'Asia/Bangkok',v_s.ends_at),coalesce(v_s.closed_at,'infinity'::timestamptz));
 if p_checked_in_at is null or not isfinite(p_checked_in_at) or p_checked_in_at < v_from or p_checked_in_at > v_to or p_checked_in_at > clock_timestamp() then
   raise exception 'Attendance time must be inside the activity and not in the future';
 end if;
 insert into public.resident_round_attendance(session_id,user_id,role_at_check_in,checked_in_at)
 values(p_session_id,p_user_id,v_role,p_checked_in_at) on conflict(session_id,user_id) do nothing;
 if not found then raise exception 'Attendance already exists; original time was kept'; end if;
 insert into public.resident_round_attendance_adjustments(session_id,user_id,actor_id,checked_in_at,reason)
 values(p_session_id,p_user_id,auth.uid(),p_checked_in_at,btrim(p_reason));
end $$;
revoke all on function public.admin_record_missing_round_attendance(uuid,uuid,timestamptz,text) from public,anon;
grant execute on function public.admin_record_missing_round_attendance(uuid,uuid,timestamptz,text) to authenticated;
notify pgrst,'reload schema';
commit;
