-- Addresses of outside web pages shown inside the "ตารางเวร / OR" page (OR schedule, rotation manager).
-- The addresses live HERE (set by an Admin), never in the code: the code repository is public.
-- Additive: one new table and two new functions. Rehearse on the staging project first.
begin;

create table if not exists public.resident_embed_links (
  link_key text primary key check (link_key in ('or_schedule', 'rota')),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  url text not null check (char_length(url) <= 500 and url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]@]*)?$'),
  updated_by uuid not null references public.resident_profiles(user_id),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.resident_embed_links enable row level security;
drop policy if exists resident_embed_links_select on public.resident_embed_links;
create policy resident_embed_links_select on public.resident_embed_links
  for select to authenticated using ((select private.resident_case_member()));
revoke all on table public.resident_embed_links from public, anon, authenticated;
grant select on table public.resident_embed_links to authenticated;

-- Admin only. https addresses only; no spaces and no user:password@ part.
create or replace function public.set_resident_embed_link(p_key text, p_title text, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_url text := btrim(coalesce(p_url, ''));
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Admin account required';
  end if;
  if p_key is null or p_key not in ('or_schedule', 'rota') then
    raise exception 'Unknown link key';
  end if;
  if char_length(v_title) not between 2 and 80 then
    raise exception 'Title must be 2-80 characters';
  end if;
  if char_length(v_url) > 500 or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]@]*)?$' then
    raise exception 'Address must start with https:// and contain no spaces or @';
  end if;
  insert into public.resident_embed_links (link_key, title, url, updated_by, updated_at)
  values (p_key, v_title, v_url, auth.uid(), clock_timestamp())
  on conflict (link_key) do update
    set title = excluded.title, url = excluded.url, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.clear_resident_embed_link(p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Admin account required';
  end if;
  delete from public.resident_embed_links where link_key = p_key;
end;
$$;

revoke all on function public.set_resident_embed_link(text, text, text) from public, anon;
revoke all on function public.clear_resident_embed_link(text) from public, anon;
grant execute on function public.set_resident_embed_link(text, text, text) to authenticated;
grant execute on function public.clear_resident_embed_link(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.set_resident_embed_link(text, text, text)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon', 'public.clear_resident_embed_link(text)'::regprocedure, 'EXECUTE')
    or has_table_privilege('anon', 'public.resident_embed_links', 'SELECT')
    or has_table_privilege('authenticated', 'public.resident_embed_links', 'INSERT')
    or has_table_privilege('authenticated', 'public.resident_embed_links', 'UPDATE')
    or has_table_privilege('authenticated', 'public.resident_embed_links', 'DELETE')
    or not (select relrowsecurity from pg_class where oid = 'public.resident_embed_links'::regclass)
  then
    raise exception 'Embed links migration check failed';
  end if;
end $$;

commit;
