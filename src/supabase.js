import { createClient } from "@supabase/supabase-js";
import { isAllowedSupabaseUrl } from "./projectGuard";

// The publishable key is intentionally safe for browser use; database access is
// enforced by Supabase Row Level Security policies in the migration directory.
// Do not provide a fallback project here: a missing environment variable must
// fail closed instead of silently connecting this app to another department.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const requiredProjectRef = "dyiiivcyoatgmkmvgcnt";
// Optional second project for a rehearsal (staging) copy. Production never sets
// it, so production behaviour is unchanged; leaving it empty keeps the guard strict.
const stagingProjectRef = (import.meta.env.VITE_ALLOWED_STAGING_PROJECT_REF || "").trim();
const localDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");

if ((!supabaseUrl || !supabasePublishableKey) && !localDemo) {
  throw new Error("Missing Surgery Logbook Supabase environment variables");
}

const allowedRefs = [requiredProjectRef, ...(stagingProjectRef ? [stagingProjectRef] : [])];
if (supabaseUrl && !isAllowedSupabaseUrl(supabaseUrl, allowedRefs)) {
  throw new Error("Resident Surgery Assessment must use the dedicated Resident Supabase project");
}

export const supabase = createClient(supabaseUrl || "https://local-demo.invalid", supabasePublishableKey || "local-demo-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
