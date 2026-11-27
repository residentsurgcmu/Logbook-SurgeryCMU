import test from "node:test";
import assert from "node:assert/strict";
import { accountProvisionMessage, inviteState } from "../src/adminInviteState.js";

test("confirmed app use outweighs mail status; historical Auth activity alone does not", () => {
  assert.equal(inviteState({ activated_at: "today", mail_status: "failed" }).resend, false);
  assert.equal(inviteState({ prior_auth_sign_in: true, sent_at: "yesterday" }).key, "sent");
  assert.equal(inviteState({ prior_auth_sign_in: true }).key, "unknown");
  assert.equal(inviteState({ sent_at: "yesterday" }).key, "sent");
  assert.equal(inviteState({ sent_at: "yesterday", mail_status: "rate_limited" }).key, "failed");
});

test("linking a profile does not claim email success when sending failed", () => {
  assert.match(accountProvisionMessage({ linkedExistingAccount: true, setupMailStatus: "rate_limited" }), /ส่งอีเมลไม่สำเร็จ/);
  assert.match(accountProvisionMessage({ linkedExistingAccount: true, setupMailStatus: "unknown" }), /ยังยืนยันผลการส่งอีเมลไม่ได้/);
  assert.match(accountProvisionMessage({ linkedExistingAccount: true, setupMailStatus: "sent" }), /ส่งลิงก์ตั้งรหัสผ่านแล้ว/);
});
