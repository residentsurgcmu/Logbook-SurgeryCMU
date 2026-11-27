import { spawnSync } from "node:child_process";
const stagingRef = "vijxiststybmuchcghux";
if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "rc/invite-qa") throw new Error("Staging Preview only");
const result = spawnSync("npm", ["run","build"], {stdio:"inherit",env:{
  ...process.env, VITE_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fLLRKk_8XeEXBm0CXQjoZg_GUM1AAcg",
  VITE_ALLOWED_STAGING_PROJECT_REF: stagingRef,
  VITE_APP_URL: "", VITE_CASE_HN_PILOT: "false", VITE_CASE_HN_TRIAL: "false",
}});
process.exit(result.status ?? 1);
