alter table public.logbook_entries
  alter column procedure_id drop not null;

alter table public.logbook_entries
  drop constraint logbook_operation_2_complete,
  drop constraint logbook_operation_3_complete;

alter table public.logbook_entries
  add constraint logbook_operation_1_present
    check (length(btrim(operation)) > 0),
  add constraint logbook_operation_2_valid
    check (
      (operation_2 is null and procedure_id_2 is null)
      or (operation_2 is not null and length(btrim(operation_2)) > 0)
    ),
  add constraint logbook_operation_3_valid
    check (
      (operation_3 is null and procedure_id_3 is null)
      or (operation_3 is not null and length(btrim(operation_3)) > 0)
    );

comment on column public.logbook_entries.procedure_id is
  'Essential procedure ID; null means the operation was entered manually and is excluded from Essential Procedure counts';
comment on column public.logbook_entries.operation is
  'Operation display name, including manual operations not listed as Essential Procedures';
comment on column public.logbook_entries.procedure_id_2 is
  'Optional Essential procedure ID; null with operation_2 populated means a manual operation';
comment on column public.logbook_entries.procedure_id_3 is
  'Optional Essential procedure ID; null with operation_3 populated means a manual operation';
