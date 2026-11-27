import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../supabase/functions/resident-admin/index.ts", import.meta.url), "utf8");
const entry = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, ""));
const actor = "41cc0938-730e-4c17-a542-36ce1188097a";
const target = "50a596b7-ff91-4fa3-b578-b9493a5ff006";

function edge({ role = "admin", claimCode, sendError } = {}) {
  const calls = [];
  const caller = { auth: { getUser: async () => ({data: {user: {id: actor}}}) } };
  const service = {
    from: (table) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "resident_user_roles" ? { role, active: true } : { active: true } }) }) }),
    }),
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "admin_claim_invite_resend") return {
        data: claimCode ? { code: claimCode } : { email: "account@example.test", attemptedAt: "2026-11-27T00:00:00Z" },
      };
      if (name === "admin_finish_invite_resend") return {};
      throw Error("Unexpected RPC");
    },
    auth: { resetPasswordForEmail: async (...args) => {
      calls.push(["resetPasswordForEmail", ...args]);
      return { error: sendError };
    } },
  };
  let handler;
  runInNewContext(entry, {
    Deno: { env: { get: (key) => key }, serve: (fn) => { handler = fn; } },
    createClient: (_, key) => key === "SUPABASE_SERVICE_ROLE_KEY" ? service : caller,
    Response, Request,
  });
  const resend = () => handler(new Request("https://example.test", {
    method: "POST", headers: { Authorization: "Bearer test" },
    body: JSON.stringify({ action: "resend_invite", userId: target, email: "different@example.test" }),
  }));
  return { calls, resend };
}

test("resend uses the email resolved by the server for the selected account ID", async () => {
  const { calls, resend } = edge();
  const response = await resend();
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].p_user_id, target);
  assert.equal(calls[0][1].p_actor_id, actor);
  assert.equal(calls[1][1], "account@example.test");
  assert.equal(calls[2][1].p_mail_status, "sent");
});

test("non-Admin, already activated account, and repeated request do not trigger mail", async () => {
  for (const [options, status] of [[{role: "resident"}, 403], [{claimCode: "ALREADY_ACTIVATED"}, 409], [{claimCode: "RESEND_COOLDOWN"}, 429]]) {
    const { calls, resend } = edge(options);
    assert.equal((await resend()).status, status);
    assert.ok(!calls.some(([action]) => action === "resetPasswordForEmail"));
  }
});

test("the email provider's 429 is recorded as failure and returned as 429", async () => {
  const { calls, resend } = edge({ sendError: { status: 429 } });
  assert.equal((await resend()).status, 429);
  assert.equal(calls[2][1].p_mail_status, "rate_limited");
});
