create index logbook_entries_procedure_id_2_idx
  on public.logbook_entries(procedure_id_2)
  where procedure_id_2 is not null;

create index logbook_entries_procedure_id_3_idx
  on public.logbook_entries(procedure_id_3)
  where procedure_id_3 is not null;
