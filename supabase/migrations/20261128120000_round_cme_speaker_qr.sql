-- Store the speaker QR independently: deleting it cannot delete the audience QR.
create table private.resident_round_cme_speaker_qr (
  session_id uuid primary key references public.resident_round_sessions(id) on delete cascade,
  storage_path text not null unique check (length(storage_path) between 1 and 500),
  speaker_url text not null check (
    length(speaker_url) <= 512 and
    speaker_url ~* '^https://score[.]ccme[.]or[.]th/event/[a-z0-9_-]+/speaker/join/?$'
  )
);
alter table private.resident_round_cme_speaker_qr enable row level security;
revoke all on private.resident_round_cme_speaker_qr from public, anon, authenticated, service_role;

create function public.admin_get_round_cme_speaker_qr(p_session_id uuid)
returns table(storage_path text, speaker_url text)
language sql stable security definer set search_path = '' as $$
  select q.storage_path, q.speaker_url
  from private.resident_round_cme_speaker_qr q
  where q.session_id = p_session_id and (select private.resident_role_is('admin'));
$$;

create function public.admin_set_round_cme_speaker_qr(p_session_id uuid, p_storage_path text, p_speaker_url text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_previous_path text;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  perform 1 from public.resident_round_sessions
    where id = p_session_id and cancelled_at is null and closed_at is null
      and ends_at >= clock_timestamp()
    for no key update;
  if not found then raise exception 'CME QR can only be changed for an upcoming or active meeting'; end if;

  if p_storage_path is null then
    delete from private.resident_round_cme_speaker_qr where session_id = p_session_id
      returning storage_path into v_previous_path;
    return v_previous_path;
  end if;

  if split_part(p_storage_path, '/', 1) is distinct from (select auth.uid())::text
    or split_part(p_storage_path, '/', 2) is distinct from p_session_id::text
    or split_part(p_storage_path, '/', 3) <> 'speaker'
    or not exists (
      select 1 from storage.objects where bucket_id = 'resident-round-cme-qr' and name = p_storage_path
    ) then
    raise exception 'Speaker QR image upload was not found';
  end if;
  select storage_path into v_previous_path from private.resident_round_cme_speaker_qr where session_id = p_session_id;
  insert into private.resident_round_cme_speaker_qr (session_id, storage_path, speaker_url)
    values (p_session_id, p_storage_path, p_speaker_url)
    on conflict (session_id) do update set storage_path = excluded.storage_path, speaker_url = excluded.speaker_url;
  return v_previous_path;
end;
$$;

revoke all on function public.admin_get_round_cme_speaker_qr(uuid), public.admin_set_round_cme_speaker_qr(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_round_cme_speaker_qr(uuid), public.admin_set_round_cme_speaker_qr(uuid,text,text) to authenticated;
