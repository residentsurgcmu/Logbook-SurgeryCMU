import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isAllowedSupabaseUrl, supabaseHostFor } from "../src/projectGuard.js";

const PROD = "dyiiivcyoatgmkmvgcnt";
const STAGING = "abcstaging123";
const src = await readFile(new URL("../src/supabase.js", import.meta.url), "utf8");

test("the production project is allowed; a staging project only when it is explicitly declared", () => {
  assert.equal(isAllowedSupabaseUrl(`https://${PROD}.supabase.co`, [PROD]), true);
  assert.equal(isAllowedSupabaseUrl(`https://${PROD}.supabase.co/`, [PROD]), true);
  assert.equal(isAllowedSupabaseUrl(`https://${STAGING}.supabase.co`, [PROD]), false, "staging not declared");
  assert.equal(isAllowedSupabaseUrl(`https://${STAGING}.supabase.co`, [PROD, STAGING]), true, "staging declared");
  assert.equal(isAllowedSupabaseUrl("https://otherdept999.supabase.co", [PROD, STAGING]), false);
  // an empty / missing declaration must never widen the guard
  assert.equal(isAllowedSupabaseUrl(`https://${STAGING}.supabase.co`, [PROD, ""]), false);
  assert.equal(isAllowedSupabaseUrl(`https://${STAGING}.supabase.co`, [PROD, undefined]), false);
  assert.equal(supabaseHostFor(PROD), `${PROD}.supabase.co`);
});

test("another site that merely CONTAINS the project name is refused (exact host name only)", () => {
  for (const url of [
    `https://evil.example/${PROD}`,
    `https://${PROD}.evil.example`,
    `https://evil.example/?x=${PROD}.supabase.co`,
    `https://${PROD}.supabase.co.evil.example`,
    `https://evil-${PROD}.supabase.co`,
    `https://user:pw@${PROD}.supabase.co`,
    `http://${PROD}.supabase.co`,
    `https://${PROD}.supabase.co@evil.example`,
    "not a url", "", null, undefined,
  ]) assert.equal(isAllowedSupabaseUrl(url, [PROD]), false, String(url));
  // letter case in the host name does not matter
  assert.equal(isAllowedSupabaseUrl(`https://${PROD.toUpperCase()}.SUPABASE.CO`, [PROD]), true);
});

test("the client is created only after the guard, with no fallback project (fail closed)", () => {
  assert.match(src, /requiredProjectRef = "dyiiivcyoatgmkmvgcnt"/);
  assert.match(src, /VITE_ALLOWED_STAGING_PROJECT_REF/);
  assert.match(src, /stagingProjectRef \? \[stagingProjectRef\] : \[\]/);
  assert.match(src, /isAllowedSupabaseUrl\(supabaseUrl, allowedRefs\)/);
  assert.doesNotMatch(src, /supabaseUrl\.includes\(/);
  assert.match(src, /Missing Surgery Logbook Supabase environment variables/);
  assert.ok(src.indexOf("isAllowedSupabaseUrl(supabaseUrl") < src.indexOf("createClient(supabaseUrl"), "guard runs before the client exists");
  assert.doesNotMatch(src, /supabase\.co/);
});
