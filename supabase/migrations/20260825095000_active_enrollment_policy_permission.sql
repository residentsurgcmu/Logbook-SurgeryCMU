begin;

grant execute on function private.is_active_enrollment(uuid,uuid) to authenticated;

commit;
