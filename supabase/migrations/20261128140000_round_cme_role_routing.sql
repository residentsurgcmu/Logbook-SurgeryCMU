-- Resolve the destination from the caller's own attendance record.
-- Require the same role to still be active, and never substitute the other QR.
create or replace function public.get_my_resident_round_cme_url(p_session_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when a.role_at_check_in = 'resident' and (select private.resident_role_is('resident')) then audience.attendee_url
    when a.role_at_check_in = 'staff' and (select private.resident_role_is('staff')) then speaker.speaker_url
  end
  from public.resident_round_attendance a
  join public.resident_round_sessions s on s.id = a.session_id and s.cancelled_at is null
  left join public.resident_round_cme_qr audience on audience.session_id = a.session_id
  left join private.resident_round_cme_speaker_qr speaker on speaker.session_id = a.session_id
  where a.session_id = p_session_id and a.user_id = (select auth.uid());
$$;

revoke all on function public.get_my_resident_round_cme_url(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_resident_round_cme_url(uuid) to authenticated;
