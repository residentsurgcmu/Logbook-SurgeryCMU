-- Add a blank-by-default slot for today's duty team in the schedule page.
-- Existing URLs, read policy, write permissions, and URL validation are unchanged.
begin;

alter table public.resident_embed_links
  drop constraint resident_embed_links_link_key_check,
  add constraint resident_embed_links_link_key_check
    check (link_key in ('or_schedule', 'rota', 'duty_today'));

create or replace function public.set_resident_embed_link(p_key text, p_title text, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_url text := btrim(coalesce(p_url, ''));
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Admin account required';
  end if;
  if p_key is null or p_key not in ('or_schedule', 'rota', 'duty_today') then
    raise exception 'Unknown link key';
  end if;
  if char_length(v_title) not between 2 and 80 then
    raise exception 'Title must be 2-80 characters';
  end if;
  if char_length(v_url) > 500 or v_url !~ '^https://[A-Za-z0-9.-]+(:([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?(/[^[:space:]@]*)?$' then
    raise exception 'Address must start with https:// and contain no spaces or @';
  end if;
  insert into public.resident_embed_links (link_key, title, url, updated_by, updated_at)
  values (p_key, v_title, v_url, auth.uid(), clock_timestamp())
  on conflict (link_key) do update
    set title = excluded.title, url = excluded.url, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_resident_embed_link(text, text, text) from public, anon;
grant execute on function public.set_resident_embed_link(text, text, text) to authenticated;

commit;
