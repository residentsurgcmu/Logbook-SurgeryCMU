create index if not exists year4_entries_rotation_id_idx
  on public.year4_logbook_entries (rotation_id)
  where rotation_id is not null;

create index if not exists year4_rotations_created_by_idx
  on public.year4_rotations (created_by);

create index if not exists year4_certifications_rotation_id_idx
  on public.year4_logbook_certifications (rotation_id)
  where rotation_id is not null;

create index if not exists year4_certifications_certified_by_idx
  on public.year4_logbook_certifications (certified_by)
  where certified_by is not null;
