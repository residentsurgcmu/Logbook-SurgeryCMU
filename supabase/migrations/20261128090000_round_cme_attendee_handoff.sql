-- Keep the original QR upload and check-in APIs available during rollout.
alter table public.resident_round_cme_qr
  add column attendee_url text
  check (attendee_url is null or (
    length(attendee_url) <= 512
    and attendee_url ~* '^https://score[.]ccme[.]or[.]th/event/[a-z0-9_-]+/audience/join/?$'
  ));

create function private.clear_replaced_round_cme_url()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.storage_path is distinct from old.storage_path then
    new.attendee_url := null;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_replaced_round_cme_url() from public, anon, authenticated, service_role;
create trigger round_cme_clear_replaced_url
before update of storage_path on public.resident_round_cme_qr
for each row execute function private.clear_replaced_round_cme_url();

create function public.set_resident_round_cme_attendee_qr(p_session_id uuid, p_storage_path text, p_attendee_url text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_previous_path text;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  perform 1 from public.resident_round_sessions where id = p_session_id and cancelled_at is null for no key update;
  if not found then raise exception 'Meeting session not found or cancelled'; end if;
  v_previous_path := public.set_resident_round_cme_qr(p_session_id, p_storage_path);
  update public.resident_round_cme_qr set attendee_url = nullif(btrim(p_attendee_url), '')
    where session_id = p_session_id;
  return v_previous_path;
end;
$$;

create function public.get_my_resident_round_cme_url(p_session_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select c.attendee_url
  from public.resident_round_cme_qr c
  join public.resident_round_sessions s on s.id = c.session_id and s.cancelled_at is null
  join public.resident_round_attendance a on a.session_id = c.session_id and a.user_id = (select auth.uid())
  where c.session_id = p_session_id and (select private.resident_account_active());
$$;

revoke all on function public.set_resident_round_cme_attendee_qr(uuid,text,text), public.get_my_resident_round_cme_url(uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_resident_round_cme_attendee_qr(uuid,text,text), public.get_my_resident_round_cme_url(uuid) to authenticated;
