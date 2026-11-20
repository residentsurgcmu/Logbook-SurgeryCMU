import { spawnSync } from "node:child_process";

const ref = "vijxiststybmuchcghux";
const url = `https://${ref}.supabase.co`;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const errors = [];
if (process.env.VERCEL_ENV !== "preview") errors.push("VERCEL_ENV must be preview.");
if (process.env.VITE_SUPABASE_URL?.trim() !== url) errors.push("VITE_SUPABASE_URL must be the designated staging URL.");
if (process.env.VITE_ALLOWED_STAGING_PROJECT_REF?.trim() !== ref) errors.push("Set VITE_ALLOWED_STAGING_PROJECT_REF to the designated staging project.");
if (process.env.VITE_CASE_HN_TRIAL !== "true") errors.push("Set VITE_CASE_HN_TRIAL=true on this preview branch.");
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key || "")) errors.push("Set a modern staging publishable key, never a secret key.");
if (errors.length) {
  console.error(["HN staging preview build refused:", ...errors].join("\n"));
  process.exit(1);
}
// Verify the exact key/project pair without performing any write or logging the key.
try {
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error();
} catch {
  console.error("HN staging preview build refused: could not verify the key on staging.");
  process.exit(1);
}
const result = spawnSync("npm", ["run","build"], { stdio:"inherit" });
process.exit(result.status ?? 1);
