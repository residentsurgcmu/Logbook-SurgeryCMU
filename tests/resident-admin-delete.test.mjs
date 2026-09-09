import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Admin assessment deletion requires an active Admin and password re-authentication", async () => {
  const [edgeFunction, api] = await Promise.all([
    read("supabase/functions/resident-admin/index.ts"),
    read("src/residentApi.js"),
  ]);
  assert.match(edgeFunction, /callerRole\.role !== "admin"/);
  assert.match(edgeFunction, /action === "delete_assessment"/);
  assert.match(edgeFunction, /signInWithPassword/);
  assert.match(edgeFunction, /scope: "local"/);
  assert.match(api, /profile\?\.role !== "admin"/);
  assert.match(api, /กรุณากรอกรหัสผ่าน Admin/);
});

test("Delete RPC is service-role only and removes linked request before the assessment", async () => {
  const migration = await read("supabase/migrations/20260909142858_admin_delete_resident_assessment.sql");
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.admin_delete_resident_assessment\(uuid, uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.admin_delete_resident_assessment\(uuid, uuid\)[\s\S]*to service_role/);
  assert.ok(migration.indexOf("delete from public.resident_assessment_requests") < migration.indexOf("delete from public.resident_assessments"));
  assert.match(migration, /resident_id = p_resident_id/);
});

test("Admin UI lists one Resident's saved assessments and warns before permanent deletion", async () => {
  const component = await read("src/features/ResidentPlatform.jsx");
  assert.match(component, /ลบหัตถการที่บันทึกแล้ว/);
  assert.match(component, /ต้องยืนยันรหัสผ่านอีกครั้ง/);
  assert.match(component, /คะแนน ผลประเมิน และข้อมูลที่เชื่อมโยงจะถูกลบออกจากฐานข้อมูลและย้อนกลับไม่ได้/);
  assert.match(component, /assessment\.resident_id === residentId/);
  assert.match(component, /deleteResidentAssessment\(workspace\.user, assessment\.id, assessment\.resident_id, password\)/);
});
