// Supabase/PostgREST caps every response at 1,000 rows by default.
export const WORKSPACE_PAGE_SIZE = 1000;

// Runs `buildQuery()` repeatedly with .range() until a short page arrives.
// `buildQuery` must return a fresh, deterministically ordered query each time.
export async function fetchAllRows(buildQuery, pageSize = WORKSPACE_PAGE_SIZE) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
}
