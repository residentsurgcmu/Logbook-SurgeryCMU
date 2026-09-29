begin;

-- Criteria are never edited in place once a signed assessment can point at
-- them: the catalog sync retires a changed criterion (active = false, text and
-- scores kept) and inserts a new active row under the same code. That needs
-- code and sort order to be unique among ACTIVE rows only; a retired row keeps
-- its old code and sort order as history.
alter table public.resident_template_criteria
  drop constraint if exists resident_template_criteria_template_id_criterion_code_key;
alter table public.resident_template_criteria
  drop constraint if exists resident_template_criteria_template_id_sort_order_key;

create unique index if not exists resident_template_criteria_active_code_key
  on public.resident_template_criteria (template_id, criterion_code) where active;
create unique index if not exists resident_template_criteria_active_sort_key
  on public.resident_template_criteria (template_id, sort_order) where active;

commit;
