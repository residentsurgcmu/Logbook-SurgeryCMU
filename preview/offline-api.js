// Replaces Supabase ONLY in the standalone preview build, never in production.
const blocked = () => { throw new Error('Offline preview: backend access is disabled'); };
export const supabase = new Proxy({}, {get:blocked});
