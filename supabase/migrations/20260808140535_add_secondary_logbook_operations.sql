alter table public.logbook_entries
  add column procedure_id_2 text references public.essential_procedures(id),
  add column operation_2 text,
  add column procedure_id_3 text references public.essential_procedures(id),
  add column operation_3 text;

alter table public.logbook_entries
  add constraint logbook_operation_2_complete
    check ((procedure_id_2 is null) = (operation_2 is null)),
  add constraint logbook_operation_3_complete
    check ((procedure_id_3 is null) = (operation_3 is null)),
  add constraint logbook_operation_2_distinct
    check (procedure_id_2 is null or procedure_id_2 <> procedure_id),
  add constraint logbook_operation_3_distinct
    check (
      procedure_id_3 is null
      or (procedure_id_3 <> procedure_id and procedure_id_3 is distinct from procedure_id_2)
    );

comment on column public.logbook_entries.procedure_id_2 is 'Optional second procedure performed in the same case';
comment on column public.logbook_entries.procedure_id_3 is 'Optional third procedure performed in the same case';
