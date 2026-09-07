begin;

-- An immutable delivery ledger makes the daily job idempotent: a Staff member
-- receives at most one digest for a Bangkok calendar date. The Edge Function
-- uses the service role; no browser role is granted write access.
create table public.staff_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null references public.user_directory(email) on delete cascade,
  delivery_date date not null,
  entry_ids uuid[] not null default '{}'::uuid[],
  entry_count integer not null default 0 check (entry_count >= 0),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint staff_digest_once_per_day unique(staff_email, delivery_date)
);

create index staff_digest_deliveries_status_date_idx
  on public.staff_digest_deliveries(delivery_date desc, status, staff_email);

create trigger staff_digest_deliveries_touch_updated_at
before update on public.staff_digest_deliveries
for each row execute function private.touch_updated_at();

alter table public.staff_digest_deliveries enable row level security;

create policy staff_digest_deliveries_admin_select on public.staff_digest_deliveries
for select to authenticated
using ((select private.is_admin()));

revoke all on public.staff_digest_deliveries from anon, authenticated;
grant select on public.staff_digest_deliveries to authenticated;

comment on table public.staff_digest_deliveries is
  'Idempotent audit ledger for the daily Staff pending-approval email digest.';

commit;
