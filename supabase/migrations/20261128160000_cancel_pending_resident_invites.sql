alter table private.resident_invite_lifecycle add column cancelled_at timestamptz;
alter table private.resident_invite_lifecycle add column cancelled_by uuid;

create function public.admin_cancel_pending_resident_invite(p_user_id uuid, p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  profile public.resident_profiles%rowtype;
  invitation private.resident_invite_lifecycle%rowtype;
  account auth.users%rowtype;
begin
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  if p_user_id is null or p_user_id = actor or p_expected_updated_at is null then raise exception 'INVITE_NOT_PENDING'; end if;
  perform pg_advisory_xact_lock(hashtextextended('resident_accounts', 0));
  perform private.resident_account_lock(actor, p_user_id);
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  if (select public.resident_accounts_paused()) then raise exception 'ACCOUNTS_PAUSED'; end if;
  select * into profile from public.resident_profiles where user_id = p_user_id for no key update;
  if not found or profile.updated_at is distinct from p_expected_updated_at then raise exception 'ACCOUNT_CONFLICT'; end if;
  select * into invitation from private.resident_invite_lifecycle where user_id = p_user_id for update;
  if invitation.cancelled_at is not null then return; end if;
  if invitation.mail_status = 'sending' and invitation.attempted_at > clock_timestamp() - interval '2 minutes' then
    raise exception 'INVITE_SENDING';
  end if;
  select * into account from auth.users where id = p_user_id for update;
  if not found or account.last_sign_in_at is not null or account.email_confirmed_at is not null or
     invitation.activated_at is not null or coalesce(invitation.sent_at, account.invited_at) is null then
    raise exception 'INVITE_NOT_PENDING';
  end if;

  if exists(select 1 from public.resident_user_roles where user_id = p_user_id and role = 'admin') then
    raise exception 'INVITE_NOT_PENDING';
  end if;
  if exists (select 1 from public.resident_user_roles where user_id = p_user_id and active) or profile.active then
    perform public.admin_set_account_active(p_user_id, false, profile.updated_at, gen_random_uuid(),
      'ยกเลิกคำเชิญที่ยังไม่ได้เปิดใช้งาน', jsonb_build_object('pending_requests', 0, 'active_assignments', 0));
  end if;

  -- Invalidate both legacy and current Auth token storage; retain the profile and audit trail.
  update auth.users set confirmation_token = '', recovery_token = '',
    banned_until = greatest(banned_until, clock_timestamp() + interval '100 years')
    where id = p_user_id;
  delete from auth.one_time_tokens where user_id = p_user_id
    and token_type::text in ('confirmation_token', 'recovery_token');
  insert into private.resident_invite_lifecycle(user_id, cancelled_at, cancelled_by)
    values (p_user_id, clock_timestamp(), actor)
    on conflict (user_id) do update set cancelled_at=excluded.cancelled_at, cancelled_by=excluded.cancelled_by;
end;
$$;
revoke all on function public.admin_cancel_pending_resident_invite(uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_pending_resident_invite(uuid,timestamptz) to authenticated;

create function private.block_cancelled_resident_invite_reactivation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active and not old.active and exists (
    select 1 from private.resident_invite_lifecycle where user_id = new.user_id and cancelled_at is not null
  ) then raise exception 'INVITE_CANCELLED'; end if;
  return new;
end;
$$;
revoke all on function private.block_cancelled_resident_invite_reactivation() from public, anon, authenticated, service_role;
create trigger block_cancelled_resident_invite_reactivation
  before update of active on public.resident_profiles
  for each row execute function private.block_cancelled_resident_invite_reactivation();

-- Keep the existing return contract for the deployed Admin page.
create or replace function public.admin_list_accounts()
returns table (
  user_id uuid, full_name text, email text, role public.resident_system_role, pgy smallint,
  unit_name text, admin_tag text, role_active boolean, profile_active boolean, active boolean,
  updated_at timestamptz, created_at timestamptz, is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  return query
  select p.user_id, p.full_name, p.email, r.role, p.pgy,
         d.unit_name, r.admin_tag, r.active, p.active, (r.active and p.active),
         p.updated_at, p.created_at, p.user_id = (select auth.uid())
  from public.resident_profiles p
  join public.resident_user_roles r on r.user_id = p.user_id
  left join public.resident_staff_directory d on d.auth_user_id = p.user_id
  where not exists (select 1 from private.resident_invite_lifecycle l where l.user_id = p.user_id and l.cancelled_at is not null)
  order by r.role, p.full_name, p.user_id;
end;
$$;
