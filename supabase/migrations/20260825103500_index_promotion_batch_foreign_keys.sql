create index if not exists student_promotion_batches_source_idx
  on public.student_promotion_batches(source_curriculum_id);
create index if not exists student_promotion_batches_destination_idx
  on public.student_promotion_batches(destination_curriculum_id);
create index if not exists student_promotion_batches_actor_idx
  on public.student_promotion_batches(actor_id);
create index if not exists student_promotion_batches_rolled_back_by_idx
  on public.student_promotion_batches(rolled_back_by) where rolled_back_by is not null;
