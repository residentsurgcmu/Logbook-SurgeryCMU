import assert from "node:assert/strict";
import test from "node:test";
import { accountDraft, accountEditPlan, accountErrorCode, accountErrorMessage, accountPreviewValid, accountStatusReason, prepareAccountAttempt } from "../src/adminAccounts.js";
import { createAdminAccountsApi } from "../src/adminAccountsApi.js";

const at = "2026-10-18T00:00:00Z";
const resident = { user_id: "fake-resident", role: "resident", full_name: "Resident Test", pgy: 2, active: true, updated_at: at };
test("name-only edit leaves PGY untouched, including legacy PGY on a Staff account", () => {
  for (const row of [resident, { ...resident, role: "staff", unit_name: "Upper GI" }, { ...resident, role: "admin", admin_tag: "custom" }]) {
    const draft = { ...accountDraft(row), full_name: "Corrected Name" };
    assert.deepEqual(accountEditPlan(row, draft).changes, { full_name: "Corrected Name" });
    assert.equal(accountEditPlan(row, draft).valid, true);
  }
});
test("PGY change requires a reason, accepts only 1–4 and sends numeric PGY only when changed", () => {
  const draft = { ...accountDraft(resident), pgy: "3" };
  assert.equal(accountEditPlan(resident, draft).valid, false);
  assert.match(accountEditPlan(resident, draft).errors.reason, /เหตุผล/);
  const plan = accountEditPlan(resident, { ...draft, reason: " Correct a mistake " });
  assert.deepEqual(plan.changes, { pgy: 3 }); assert.equal(plan.reason, "Correct a mistake");
  for (const pgy of ["0", "5", "1.5", "3x"]) assert.equal(accountEditPlan(resident, { ...draft, pgy, reason: "test" }).valid, false);
});
test("a Resident with legacy missing PGY can edit a name without inventing PGY 1", () => {
  const row = { ...resident, pgy: null };
  const draft = { ...accountDraft(row), full_name: "Corrected Name" };
  assert.equal(draft.pgy, "");
  assert.deepEqual(accountEditPlan(row, draft).changes, { full_name: "Corrected Name" });
  assert.equal(accountEditPlan(row, draft).valid, true);
  assert.equal(accountEditPlan(row, { ...draft, pgy: "1" }).valid, false);
});
test("unchanged values create no mutation; role-specific fields cannot leak from the form", () => {
  assert.equal(accountEditPlan(resident, accountDraft(resident)).changed, false);
  const draft = { ...accountDraft(resident), unit_name: "Wrong unit", admin_tag: "Wrong tag" };
  assert.deepEqual(accountEditPlan(resident, draft).changes, {});
  const staff = { ...resident, role: "staff", unit_name: "Upper GI" };
  assert.deepEqual(accountEditPlan(staff, { ...accountDraft(staff), pgy: "4" }).changes, {});
});
test("Staff units and free-form Admin tags follow the backend contract", () => {
  const staff = { ...resident, role: "staff", unit_name: "Upper GI" };
  assert.deepEqual(accountEditPlan(staff, { ...accountDraft(staff), unit_name: " HPB " }).changes, { unit_name: "HPB" });
  assert.equal(accountEditPlan(staff, { ...accountDraft(staff), unit_name: "" }).valid, false);
  // A null unit does not establish that the directory row is missing. The RPC checks that link.
  const noUnit = { ...staff, unit_name: null };
  assert.deepEqual(accountEditPlan(noUnit, { ...accountDraft(noUnit), unit_name: "New unit" }).changes, { unit_name: "New unit" });
  const admin = { ...resident, role: "admin", admin_tag: "F" };
  assert.deepEqual(accountEditPlan(admin, { ...accountDraft(admin), admin_tag: "Education" }).changes, { admin_tag: "Education" });
  assert.deepEqual(accountEditPlan(admin, { ...accountDraft(admin), admin_tag: "" }).changes, { admin_tag: null });
});
test("both activation directions require a reason and cap Unicode characters", () => {
  assert.match(accountStatusReason(" \n "), /เหตุผล/);
  assert.equal(accountStatusReason("ก".repeat(300)), "");
  assert.match(accountStatusReason("ก".repeat(301)), /300/);
  assert.equal(accountStatusReason("😀".repeat(300)), "");
});
const preview = { user_id: resident.user_id, action: "deactivate", active: true, updated_at: at, blockers: [], pending_requests: 2, active_assignments: 1, preview_counts: { pending_requests: 2, active_assignments: 1 } };
test("missing, mismatched or invalid preview counts fail closed", () => {
  assert(accountPreviewValid(preview, resident.user_id, "deactivate"));
  for (const broken of [null, { ...preview, user_id: "other" }, { ...preview, action: "reactivate" }, { ...preview, updated_at: "bad" }, { ...preview, preview_counts: null }, { ...preview, blockers: null }, { ...preview, pending_requests: 3 }, { ...preview, preview_counts: { pending_requests: -1, active_assignments: 1 } }]) assert(!accountPreviewValid(broken, resident.user_id, "deactivate"));
});
test("business errors are translated without leaking raw database details", () => {
  for (const code of ["ACCOUNT_CONFLICT", "PREVIEW_CHANGED", "LAST_ADMIN", "SELF_ACTION_FORBIDDEN", "ROLE_RULE", "ACCOUNT_EXISTS", "ACCOUNTS_PAUSED"]) {
    const error = { code: "P0001", message: `${code}: PRIVATE_DATABASE_DETAIL` };
    assert.equal(accountErrorCode(error), code); assert(!accountErrorMessage(error).includes("PRIVATE_DATABASE_DETAIL"));
  }
  assert(!accountErrorMessage(new Error("PRIVATE_DATABASE_DETAIL")).includes("PRIVATE_DATABASE_DETAIL"));
});
test("uncertain retries reuse request ID; an explicitly different operation gets a new ID", () => {
  let count = 0; const uuid = () => `id-${++count}`;
  const payload = { userId: "fake", updatedAt: at, changes: { pgy: 3 }, reason: "reason" };
  const first = prepareAccountAttempt(null, "edit", payload, uuid);
  assert.equal(prepareAccountAttempt(first, "edit", { ...payload }, uuid), first);
  assert.equal(count, 1);
  assert.notEqual(prepareAccountAttempt(first, "edit", { ...payload, reason: "different" }, uuid).requestId, first.requestId);
});
function clientFor(handler) { return { rpc(name, args) { return { then(resolve, reject) { return Promise.resolve().then(() => handler(name, args)).then(resolve,reject); }, range(from,to) { return handler(name,args,from,to); } }; } }; }
test("RPC API pages lists and never treats missing results as an empty success", async () => {
  const pages=[]; const client=clientFor((name,args,from,to)=>{pages.push([name,from,to]);return { data: from === 0 ? Array.from({length:1000},(_,i)=>({user_id:`fake-${i}`})) : [{user_id:"last"}], error:null };});
  assert.equal((await createAdminAccountsApi(client).listAdminAccounts()).length,1001);
  assert.deepEqual(pages.map(x=>x.slice(1)),[[0,999],[1000,1999]]);
  await assert.rejects(createAdminAccountsApi(clientFor(()=>({data:null,error:null}))).listAdminAccounts(),/Incomplete/);
});
test("RPC API sends exact expected timestamp, request ID and confirmed counts without table writes", async () => {
  const calls=[]; const api=createAdminAccountsApi(clientFor((name,args)=>{calls.push([name,args]);return {data: name==='admin_update_account'?{user_id:'fake',updated_at:at,changed:true}:{user_id:'fake',updated_at:at,active:false},error:null};}));
  await api.updateAdminAccount({userId:'fake',updatedAt:at,requestId:'retry-id',changes:{full_name:'Name'},reason:null});
  await api.setAdminAccountActive({userId:'fake',updatedAt:at,requestId:'status-id',active:false,reason:'reason',previewCounts:{pending_requests:2,active_assignments:1}});
  assert.deepEqual(calls,[['admin_update_account',{p_user_id:'fake',p_expected_updated_at:at,p_request_id:'retry-id',p_changes:{full_name:'Name'},p_reason:null}],['admin_set_account_active',{p_user_id:'fake',p_active:false,p_expected_updated_at:at,p_request_id:'status-id',p_reason:'reason',p_preview_counts:{pending_requests:2,active_assignments:1}}]]);
});
test("RPC errors and incomplete write responses cannot appear as successful saves", async () => {
  const error={message:'ACCOUNT_CONFLICT: changed',code:'P0001'};
  await assert.rejects(createAdminAccountsApi(clientFor(()=>({data:null,error}))).updateAdminAccount({}),e=>e===error);
  await assert.rejects(createAdminAccountsApi(clientFor(()=>({data:{user_id:'different',changed:true,updated_at:at},error:null}))).updateAdminAccount({userId:'fake'}),/Incomplete/);
  await assert.rejects(createAdminAccountsApi(clientFor(()=>({data:{user_id:'fake',active:true,updated_at:at},error:null}))).setAdminAccountActive({userId:'fake',active:false}),/Incomplete/);
  await assert.rejects(createAdminAccountsApi(clientFor(()=>({data:{...preview,preview_counts:null},error:null}))).previewAdminAccountAction(resident.user_id,'deactivate'),/Incomplete/);
});
