-- Account access and onboarding are independent. No client can read/write tracking rows directly.
create table private.resident_invite_lifecycle (
  user_id uuid primary key references public.resident_profiles(user_id) on delete cascade,
  activated_at timestamptz,
  sent_at timestamptz,
  attempted_at timestamptz,
  mail_status text check (mail_status in ('sending','sent','failed','rate_limited','unknown'))
);
revoke all on private.resident_invite_lifecycle from public, anon, authenticated, service_role;
alter table private.resident_invite_lifecycle enable row level security;

create function public.resident_record_password_activation()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Invite/recovery OTP sessions must never count as a password sign-in.
  if v_actor is null or not (coalesce(auth.jwt()->'amr', '[]'::jsonb) @> '[{"method":"password"}]'::jsonb)
    or not (select private.resident_account_active()) then return; end if;
  insert into private.resident_invite_lifecycle (user_id, activated_at) values (v_actor, now())
  on conflict (user_id) do update set activated_at = excluded.activated_at
  where resident_invite_lifecycle.activated_at is null;
end;
$$;

create function public.admin_list_invite_states(p_user_ids uuid[])
returns table (user_id uuid, activated_at timestamptz, sent_at timestamptz, mail_status text, prior_auth_sign_in boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  if cardinality(p_user_ids) > 200 then raise exception 'Too many accounts'; end if;
  return query
  select p.user_id, l.activated_at, coalesce(l.sent_at, u.invited_at), l.mail_status,
    u.last_sign_in_at is not null
  from public.resident_profiles p
  join public.resident_user_roles r on r.user_id = p.user_id
  join auth.users u on u.id = p.user_id
  left join private.resident_invite_lifecycle l on l.user_id = p.user_id
  where p.user_id = any(p_user_ids);
end;
$$;

-- The service calls this with the verified Admin's ID. Serialize requests per target.
create function public.admin_claim_invite_resend(p_actor_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_attempt timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.resident_profiles p join public.resident_user_roles r using (user_id)
    where p.user_id = p_actor_id and p.active and r.active and r.role = 'admin'
  ) then return jsonb_build_object('code', 'FORBIDDEN'); end if;
  if public.resident_accounts_paused() then return jsonb_build_object('code', 'ACCOUNTS_PAUSED'); end if;
  if p_actor_id = p_user_id then return jsonb_build_object('code', 'RESEND_UNAVAILABLE'); end if;
  select u.email into v_email from public.resident_profiles p
  join public.resident_user_roles r using (user_id)
  join auth.users u on u.id = p.user_id
  where p.user_id = p_user_id and p.active and r.active and lower(trim(p.email)) = lower(trim(u.email))
  for no key update of p, r;
  if coalesce(v_email, '') = '' then return jsonb_build_object('code', 'RESEND_UNAVAILABLE'); end if;

  insert into private.resident_invite_lifecycle (user_id, attempted_at, mail_status)
  values (p_user_id, v_attempt, 'sending')
  on conflict (user_id) do update set attempted_at = excluded.attempted_at, mail_status = 'sending'
  where resident_invite_lifecycle.activated_at is null
    and (resident_invite_lifecycle.attempted_at is null
      or resident_invite_lifecycle.attempted_at <= v_attempt - interval '1 minute');
  if not found then
    if exists (select 1 from private.resident_invite_lifecycle where user_id = p_user_id and activated_at is not null) then
      return jsonb_build_object('code', 'ALREADY_ACTIVATED');
    end if;
    return jsonb_build_object('code', 'RESEND_COOLDOWN');
  end if;
  return jsonb_build_object('email', v_email, 'attemptedAt', v_attempt);
end;
$$;

create function public.admin_finish_invite_resend(
  p_user_id uuid, p_attempted_at timestamptz, p_mail_status text
)
returns void language sql security definer set search_path = '' as $$
  update private.resident_invite_lifecycle
  set mail_status = p_mail_status,
      sent_at = case when p_mail_status = 'sent' then now() else sent_at end
  where user_id = p_user_id and attempted_at = p_attempted_at and mail_status = 'sending'
    and p_mail_status in ('sent','failed','rate_limited','unknown');
$$;

revoke all on function public.resident_record_password_activation(), public.admin_list_invite_states(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.resident_record_password_activation(), public.admin_list_invite_states(uuid[]) to authenticated;
revoke all on function public.admin_claim_invite_resend(uuid,uuid), public.admin_finish_invite_resend(uuid,timestamptz,text) from public, anon, authenticated, service_role;
grant execute on function public.admin_claim_invite_resend(uuid,uuid), public.admin_finish_invite_resend(uuid,timestamptz,text) to service_role;
