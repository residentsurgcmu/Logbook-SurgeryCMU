// Which Supabase projects this app may talk to. Compares the exact host name (https://<ref>.supabase.co),
// never "contains the ref": another site whose address merely includes the project name must be refused.
export const supabaseHostFor = (ref) => `${ref}.supabase.co`;

export function isAllowedSupabaseUrl(url, refs) {
  let parsed;
  try { parsed = new URL(String(url || "")); } catch { return false; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return refs.filter(Boolean).some((ref) => host === supabaseHostFor(String(ref).toLowerCase()));
}
