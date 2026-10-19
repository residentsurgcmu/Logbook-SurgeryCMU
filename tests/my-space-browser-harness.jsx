// Local synthetic UI harness only; this is not an application entry point.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ResidentPlatform from "../src/features/ResidentPlatform";
import { residentTemplates } from "../src/generated/residentTemplates";
import fixtures from "../docs/rc04/RC04_backend_fixtures_v2.json";
import "../src/tokens.css";
import "../src/styles.css";
import "../src/resident.css";
import "../src/mobile-assessment.css";
import "../src/residentCorner.css";
import "../src/mySpace.css";
import "../src/seatMap.css";
const residentId = fixtures.cases.find((c) => c.n === 29).response.rows[0].resident_id;
const templates = residentTemplates.map((t) => ({ id: `fixture-${t.code}`, template_code: t.code, title: t.title, template_type: t.type,
  score_options: t.scoreOptions, max_attempts: t.type === "EPA" ? 3 : null, max_attempts_per_year: t.type === "EPA" ? 1 : null }));
const definition = (code) => templates.find((t) => t.template_code === code);
function workspace(empty = false, long = false) {
  const profile = { id: residentId, name: long ? "นพ.ชื่อสมมติที่ยาวมากสำหรับตรวจการจัดวางหน้าจอและไม่ใช่ข้อมูลบุคคลจริง ทดสอบการตัดบรรทัด" : "Resident สมมติ", pgy: 2, role: "resident" };
  return { user: profile, profiles: [{ id: "staff-fixture", name: "Staff สมมติ" }, profile], allProfiles: [{ id: "staff-fixture", name: "Staff สมมติ" }, profile], notifications: [],
    templates: long ? templates.map((t) => ({ ...t, title: t.title + " — ตัวอย่างชื่อแบบประเมินที่มีรายละเอียดเพิ่มเติมสำหรับตรวจข้อความยาว" })) : templates,
    requests: empty ? [] : ["EPA-4", "EPA-7-L3", "PBA-03"].map((code, i) => ({ id: `fixture-r${i}`, resident_id: residentId, staff_id: "staff-fixture", template_id: definition(code).id, resident_template_definitions: definition(code), status: "pending", submitted_at: "2026-10-16T04:00:00Z" })),
    assessments: empty ? [] : ["EPA-1", "EPA-2", "EPA-3", "PBA-01", "PBA-14"].map((code, i) => ({ id: `fixture-a${i}`, resident_id: residentId, evaluator_id: "staff-fixture", template_id: definition(code).id, resident_template_definitions: definition(code), assessment_date: "2026-10-18", created_at: "2026-10-18T04:00:00Z" })),
    epaProgress: templates.filter((t) => t.template_type === "EPA").map((t, i) => ({ template_code: t.template_code, title: long ? t.title + " — ข้อความยาวสำหรับตรวจการจัดวาง" : t.title, attempts_used: empty ? 0 : 1, attempts_cap: 3, attempts_this_year: empty ? 0 : 1, met: !empty && i < 3, latest_below: [] })),
  };
}
function Harness() {
  const [data, setData] = useState(() => workspace());
  window.setMySpaceScenario = (scenario) => setData(workspace(scenario === "empty", scenario === "long"));
  return <ResidentPlatform workspace={data} onRefresh={() => {}} onLogout={() => {}} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
