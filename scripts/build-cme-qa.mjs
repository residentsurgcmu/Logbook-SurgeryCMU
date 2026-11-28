import { spawnSync } from "node:child_process";
const ref = "vijxiststybmuchcghux";
if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "rc/cme-qa") throw new Error("CME rehearsal Preview only");
const child = spawnSync("npm", ["run", "build"], { stdio: "inherit", env: {
  ...process.env,
  VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_ALLOWED_STAGING_PROJECT_REF: ref,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fLLRKk_8XeEXBm0CXQjoZg_GUM1AAcg",
  VITE_APP_URL: "", VITE_CASE_HN_PILOT: "false", VITE_CASE_HN_TRIAL: "false",
}});
process.exit(child.status ?? 1);
