import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteResidentAssessment,
  inviteStaff,
  markNotificationRead,
  provisionAccount,
  recordHistoricalAssessment,
  saveAssignment,
  syncSourceTemplates,
} from "../residentApi";
import ResidentDashboard from "./ResidentDashboard";
import ResidentCornerHome, { CornerService } from "./ResidentCornerHome";
import ResidentSchedule from "./ResidentSchedule";
import {
  AssessmentHistory,
  OutcomeSelect,
  ResidentRequestForm,
  ResidentRequestHistory,
  ScoreGrid,
  ScoreLegend,
  StaffAvailabilityCard,
  StaffEvaluationForm,
} from "./ResidentAssessmentViews";
import ResidentExams from "./ResidentExams";
import ResidentCases from "./ResidentCases";
import ResidentConference from "./ResidentConference";
import ResidentExportCenter from "./ResidentExportCenter";
import { RoundAdmin, RoundCheckIn } from "./RoundAttendance";
import { parseRoundToken } from "../roundSchedule";
import { bottomNav, groupNav } from "../navGroups";
import {
  BedIcon,
  BellIcon,
  BookIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  FileIcon,
  HomeIcon,
  KeyIcon,
  MenuIcon,
  MicIcon,
  PlusIcon,
  QrIcon,
  ScanIcon,
  XIcon,
} from "../components/Icons";
import {
  parseResidentQrToken,
  ResidentQrCard,
  StaffQrScanner,
} from "./ResidentQr";

const today = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date());
const readableDate = (value) =>
  new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(
    new Date(`${value}T00:00:00`),
  );
const readableDateTime = (value) =>
  value
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Bangkok",
      }).format(new Date(value))
    : "—";
const roleLabel = { admin: "Admin", staff: "Staff", resident: "Resident" };

function RequestQueue({ requests, profiles, onSelect }) {
  const names = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const pending = requests.filter((request) => request.status === "pending");
  if (!pending.length)
    return (
      <section className="resident-panel empty">
        <h2>ไม่มีแบบประเมินรอดำเนินการ</h2>
        <p>
          เมื่อ Resident เลือกชื่อ Staff และส่งแบบประเมิน รายการจะปรากฏที่นี่
        </p>
      </section>
    );
  return (
    <section className="resident-panel">
      <h2>แบบประเมินที่รอดำเนินการ</h2>
      <div className="resident-table-wrap">
        <table>
          <thead>
            <tr>
              <th>ส่งเมื่อ</th>
              <th>Resident</th>
              <th>แบบประเมิน</th>
              <th>ครั้งที่</th>
              <th>กิจกรรม</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((request) => (
              <tr key={request.id}>
                <td>{readableDateTime(request.submitted_at)}</td>
                <td>{names.get(request.resident_id) || "—"}</td>
                <td>
                  {request.resident_template_definitions?.template_code} ·{" "}
                  {request.resident_template_definitions?.title}
                </td>
                <td>{request.attempt_number}</td>
                <td>{request.procedure_or_activity}</td>
                <td>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => onSelect(request)}
                  >
                    เปิดประเมิน
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Notifications({ notifications, onRead }) {
  const [error, setError] = useState("");
  async function read(id) {
    setError("");
    try { await onRead(id); }
    catch (nextError) { setError(nextError.message || "ทำเครื่องหมายว่าอ่านแล้วไม่สำเร็จ กรุณาลองใหม่"); }
  }
  if (!notifications.length)
    return (
      <section className="resident-panel empty">
        <h2>ยังไม่มี notification</h2>
      </section>
    );
  return (
    <section className="resident-panel">
      <h2>Notification ในระบบ</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="notification-list">
        {notifications.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.read_at ? "notification-card read" : "notification-card"
            }
            onClick={() => !item.read_at && read(item.id)}
          >
            <span>{item.title}</span>
            <p>{item.message}</p>
            <small>
              {readableDateTime(item.created_at)}
              {item.read_at
                ? " · อ่านแล้ว"
                : " · กดเพื่อทำเครื่องหมายว่าอ่านแล้ว"}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function StaffDirectory({ staffDirectory, onInvite, busyEmail }) {
  return (
    <section className="resident-panel">
      <div className="section-heading">
        <h2>รายชื่อ Staff ที่อนุมัติ</h2>
        <p>
          นำเข้าจากรายชื่ออาจารย์ ปี 4 แล้ว; Admin ส่งคำเชิญได้รายบุคคลเท่านั้น
        </p>
      </div>
      <div className="resident-table-wrap">
        <table>
          <thead>
            <tr>
              <th>หน่วย</th>
              <th>ชื่อ</th>
              <th>อีเมล</th>
              <th>สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {staffDirectory.map((staff) => (
              <tr key={staff.email}>
                <td>{staff.unit_name}</td>
                <td>{staff.full_name}</td>
                <td>{staff.email}</td>
                <td>
                  {!staff.active
                    ? "ไม่เปิดใช้งาน"
                    : staff.auth_user_id
                      ? "ส่งคำเชิญแล้ว / มีบัญชี"
                      : "รอส่งคำเชิญ"}
                </td>
                <td>
                  {staff.active && !staff.auth_user_id && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => onInvite(staff)}
                      disabled={busyEmail === staff.email}
                    >
                      {busyEmail === staff.email ? "กำลังส่ง…" : "ส่งคำเชิญ"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminAssessmentDeletion({ workspace, onRefresh }) {
  const residents = workspace.profiles.filter((profile) => profile.pgy);
  const [residentId, setResidentId] = useState(residents[0]?.id || "");
  const [password, setPassword] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const names = useMemo(
    () =>
      new Map(
        (workspace.allProfiles || workspace.profiles).map((profile) => [
          profile.id,
          profile.name,
        ]),
      ),
    [workspace.allProfiles, workspace.profiles],
  );
  const assessments = useMemo(
    () =>
      workspace.assessments.filter(
        (assessment) => assessment.resident_id === residentId,
      ),
    [workspace.assessments, residentId],
  );

  async function removeAssessment(assessment) {
    const template = assessment.resident_template_definitions;
    const description = `${template?.template_code || "EPA/PBA"} · ${assessment.procedure_or_activity || template?.title || "หัตถการที่เลือก"}`;
    if (
      !window.confirm(
        `ยืนยันลบ ${description} ของ ${names.get(assessment.resident_id) || "Resident ที่เลือก"}? คะแนน ผลประเมิน และข้อมูลที่เชื่อมโยงจะถูกลบออกจากฐานข้อมูลและย้อนกลับไม่ได้`,
      )
    )
      return;
    setBusyId(assessment.id);
    setError("");
    setMessage("");
    try {
      await deleteResidentAssessment(
        workspace.user,
        assessment.id,
        assessment.resident_id,
        password,
      );
      setPassword("");
      setMessage("ลบหัตถการที่เลือกออกจากฐานข้อมูลแล้ว โดยไม่กระทบรายการอื่น");
      await onRefresh();
    } catch (nextError) {
      setError(nextError.message || "ลบหัตถการไม่สำเร็จ");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="resident-panel admin-assessment-delete">
      <div className="section-heading">
        <h2>ลบหัตถการที่บันทึกแล้ว</h2>
        <p>
          เฉพาะ Admin · ต้องยืนยันรหัสผ่านอีกครั้งก่อนลบข้อมูลจริงจาก Supabase
        </p>
      </div>
      <div className="admin-delete-controls">
        <label>
          Resident
          <select
            value={residentId}
            onChange={(event) => {
              setResidentId(event.target.value);
              setMessage("");
              setError("");
            }}
          >
            <option value="">เลือก Resident</option>
            {residents.map((resident) => (
              <option key={resident.id} value={resident.id}>
                {resident.name} · PGY {resident.pgy}
              </option>
            ))}
          </select>
        </label>
        <label>
          รหัสผ่าน Admin เพื่อยืนยัน
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-success">{message}</p>}
      <div className="resident-table-wrap">
        <table>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>แบบประเมิน</th>
              <th>กิจกรรม/หัตถการ</th>
              <th>ผู้ประเมิน</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((assessment) => (
              <tr key={assessment.id}>
                <td>{readableDate(assessment.assessment_date)}</td>
                <td>
                  {assessment.resident_template_definitions?.template_code} ·{" "}
                  {assessment.resident_template_definitions?.title}
                </td>
                <td>{assessment.procedure_or_activity || "—"}</td>
                <td>{names.get(assessment.evaluator_id) || "—"}</td>
                <td>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => removeAssessment(assessment)}
                    disabled={!password || Boolean(busyId)}
                  >
                    {busyId === assessment.id ? "กำลังลบ…" : "ลบรายการนี้"}
                  </button>
                </td>
              </tr>
            ))}
            {residentId && !assessments.length && (
              <tr>
                <td className="table-empty" colSpan="5">
                  Resident คนนี้ยังไม่มีผลการประเมินที่บันทึกแล้ว
                </td>
              </tr>
            )}
            {!residentId && (
              <tr>
                <td className="table-empty" colSpan="5">
                  กรุณาเลือก Resident
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoricalAssessmentEntry({ workspace, onRefresh }) {
  const residents = workspace.profiles.filter((profile) => profile.pgy);
  const staff = workspace.registeredStaff || [];
  const [templateId, setTemplateId] = useState(workspace.templates[0]?.id || "");
  const [residentId, setResidentId] = useState(residents[0]?.id || "");
  const [evaluatorId, setEvaluatorId] = useState(staff[0]?.user_id || "");
  const [date, setDate] = useState(today());
  const [activity, setActivity] = useState("");
  const [context, setContext] = useState("");
  const [outcome, setOutcome] = useState("");
  const [comment, setComment] = useState("");
  const [scores, setScores] = useState({});
  const [comments, setComments] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const template = workspace.templates.find((item) => item.id === templateId);

  async function submit(event) {
    event.preventDefault();
    if (!template || !residentId || !evaluatorId || !activity.trim() || !outcome)
      return setError("กรุณาระบุ Resident, Staff ผู้ประเมิน, กิจกรรม และผลสรุป");
    if (template.criteria.some((criterion) => !scores[criterion.id]))
      return setError("กรุณากรอกคะแนนทุกเกณฑ์ของแบบประเมิน");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await recordHistoricalAssessment({
        templateId,
        residentId,
        evaluatorId,
        date,
        activity,
        context,
        outcome,
        comment,
        scores: template.criteria.map((criterion) => ({
          criterionId: criterion.id,
          score: scores[criterion.id],
          comment: comments[criterion.id] || "",
        })),
      });
      setActivity("");
      setContext("");
      setOutcome("");
      setComment("");
      setScores({});
      setComments({});
      setMessage("บันทึกผล EPA/PBA ย้อนหลังแล้ว โดยคง Staff ผู้ประเมินเดิมไว้");
      await onRefresh();
    } catch (nextError) {
      setError(nextError.message || "บันทึก EPA/PBA ย้อนหลังไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="resident-panel assessment-form historical-assessment" onSubmit={submit}>
      <div className="section-heading">
        <h2>บันทึก EPA/PBA ย้อนหลัง</h2>
        <p>Admin เป็นผู้นำเข้า แต่ระบบจะแสดง Staff ที่เลือกเป็นผู้ประเมินเดิม</p>
      </div>
      {!residents.length || !staff.length || !template ? (
        <p className="form-error">ต้องมี Resident, Staff ที่ลงทะเบียน และ catalog EPA/PBA ก่อนบันทึกรายการย้อนหลัง</p>
      ) : <>
        <div className="resident-form-grid">
          <label>Resident<select value={residentId} onChange={(event) => setResidentId(event.target.value)} required>{residents.map((resident) => <option key={resident.id} value={resident.id}>{resident.name} · PGY {resident.pgy}</option>)}</select></label>
          <label>Staff ผู้ประเมินเดิม<select value={evaluatorId} onChange={(event) => setEvaluatorId(event.target.value)} required>{staff.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name}{person.unit_name ? ` · ${person.unit_name}` : ""}</option>)}</select></label>
          <label>วันที่ประเมิน<input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} required /></label>
          <label>แบบประเมิน<select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setScores({}); setComments({}); setOutcome(""); }} required>{workspace.templates.map((item) => <option key={item.id} value={item.id}>{item.template_code} · {item.title}</option>)}</select></label>
          <label className="wide">กิจกรรม/หัตถการ<input value={activity} maxLength="240" onChange={(event) => setActivity(event.target.value)} required /></label>
          <label className="wide">บริบททางคลินิก (ถ้ามี)<textarea value={context} maxLength="500" onChange={(event) => setContext(event.target.value)} /></label>
          <OutcomeSelect template={template} value={outcome} onChange={setOutcome} label="ผลสรุป" />
          <label>ความเห็นเพิ่มเติม (ถ้ามี)<textarea value={comment} maxLength="2000" onChange={(event) => setComment(event.target.value)} /></label>
        </div>
        <ScoreLegend template={template} />
        <ScoreGrid template={template} scores={scores} onScore={(id, value) => setScores((current) => ({ ...current, [id]: value }))} comments={comments} onComment={(id, value) => setComments((current) => ({ ...current, [id]: value }))} />
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-success" role="status">{message}</p>}
        <button className="primary-button" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกผล EPA/PBA ย้อนหลัง"}</button>
      </>}
    </form>
  );
}

function Admin({ workspace, onRefresh }) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyEmail, setBusyEmail] = useState("");
  // A double click must not send two invitations (the second one falls back
  // to a password-reset email). The ref blocks clicks before React re-renders.
  const [formBusy, setFormBusy] = useState("");
  const formBusyRef = useRef("");
  const [account, setAccount] = useState({
    fullName: "",
    email: "",
    role: "resident",
    pgy: "1",
    unitName: "",
  });
  const [assignment, setAssignment] = useState({ staffId: "", residentId: "" });
  const residents = workspace.profiles.filter((profile) => profile.pgy);
  const staffIds = new Set(
    workspace.staffDirectory
      .filter((staff) => staff.active && staff.auth_user_id)
      .map((staff) => staff.auth_user_id),
  );
  const staff = workspace.profiles.filter(
    (profile) => profile.id !== workspace.user.id && staffIds.has(profile.id),
  );
  async function sync() {
    setSyncing(true);
    setError("");
    try {
      await syncSourceTemplates({
        includePerYear: workspace.templates.some((item) => "max_attempts_per_year" in item),
      });
      await onRefresh();
      setMessage("ซิงก์ EPA/PBA source สำเร็จ");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSyncing(false);
    }
  }
  async function addAccount(event) {
    event.preventDefault();
    if (formBusyRef.current) return;
    formBusyRef.current = "account";
    setFormBusy("account");
    setError("");
    try {
      const result = await provisionAccount({
        ...account,
        pgy: Number(account.pgy),
      });
      setMessage(
        result.invitationSent
          ? "ส่งคำเชิญเปิดบัญชีแล้ว"
          : result.linkedExistingAccount
            ? "ผูกบัญชีเดิมของอีเมลนี้แล้ว และส่งลิงก์ตั้งรหัสผ่านไปทางอีเมล"
            : result.alreadyProvisioned
            ? "Staff นี้มีบัญชีในระบบแล้ว"
            : "อัปเดตสิทธิ์บัญชีแล้ว",
      );
      setAccount({
        fullName: "",
        email: "",
        role: "resident",
        pgy: "1",
        unitName: "",
      });
      await onRefresh();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      formBusyRef.current = "";
      setFormBusy("");
    }
  }
  async function assign(event) {
    event.preventDefault();
    if (formBusyRef.current) return;
    formBusyRef.current = "assign";
    setFormBusy("assign");
    setError("");
    try {
      await saveAssignment(assignment.staffId, assignment.residentId);
      setMessage("บันทึกการมอบหมาย Staff แล้ว");
      await onRefresh();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      formBusyRef.current = "";
      setFormBusy("");
    }
  }
  async function invite(staffMember) {
    setBusyEmail(staffMember.email);
    setError("");
    try {
      const result = await inviteStaff(staffMember.email);
      setMessage(
        result.invitationSent
          ? `ส่งคำเชิญให้ ${staffMember.full_name} แล้ว`
          : result.linkedExistingAccount
            ? `ผูกบัญชีเดิมของ ${staffMember.full_name} แล้ว และส่งลิงก์ตั้งรหัสผ่านไปทางอีเมล`
            : `${staffMember.full_name} มีบัญชีอยู่แล้ว`,
      );
      await onRefresh();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusyEmail("");
    }
  }
  return (
    <>
      <section className="resident-panel admin-summary">
        <div>
          <h2>Catalog EPA/PBA</h2>
          <p>
            {workspace.templates.length} แบบประเมิน · สร้างจากไฟล์ใน EPA/ และ
            PBA/ เท่านั้น
          </p>
        </div>
        <button className="primary-button" onClick={sync} disabled={syncing}>
          {syncing ? "กำลังซิงก์…" : "ซิงก์ source catalog"}
        </button>
      </section>
      <AdminAssessmentDeletion workspace={workspace} onRefresh={onRefresh} />
      <HistoricalAssessmentEntry workspace={workspace} onRefresh={onRefresh} />
      <div className="admin-grid">
        <form className="resident-panel" onSubmit={addAccount}>
          <h2>เพิ่มบัญชี Resident / Staff / Admin</h2>
          <label>
            ชื่อ–นามสกุล
            <input
              value={account.fullName}
              onChange={(event) =>
                setAccount({ ...account, fullName: event.target.value })
              }
              required
            />
          </label>
          <label>
            อีเมล
            <input
              type="email"
              value={account.email}
              onChange={(event) =>
                setAccount({ ...account, email: event.target.value })
              }
              required
            />
          </label>
          <label>
            บทบาท
            <select
              value={account.role}
              onChange={(event) =>
                setAccount({ ...account, role: event.target.value })
              }
            >
              <option value="resident">Resident</option>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {account.role === "resident" && (
            <label>
              PGY
              <select
                value={account.pgy}
                onChange={(event) =>
                  setAccount({ ...account, pgy: event.target.value })
                }
              >
                {[1, 2, 3, 4].map((year) => (
                  <option key={year} value={year}>
                    PGY {year}
                  </option>
                ))}
              </select>
            </label>
          )}
          {account.role === "staff" && (
            <label>
              หน่วย
              <input
                value={account.unitName}
                onChange={(event) =>
                  setAccount({ ...account, unitName: event.target.value })
                }
                minLength="2"
                maxLength="80"
                required
              />
            </label>
          )}
          <button className="primary-button" disabled={Boolean(formBusy)}>
            {formBusy === "account" ? "กำลังส่งคำเชิญ…" : "ส่งคำเชิญ"}
          </button>
        </form>
        <form className="resident-panel" onSubmit={assign}>
          <h2>มอบหมาย Staff</h2>
          <label>
            Staff
            <select
              value={assignment.staffId}
              onChange={(event) =>
                setAssignment({ ...assignment, staffId: event.target.value })
              }
              required
            >
              <option value="">เลือก Staff</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Resident
            <select
              value={assignment.residentId}
              onChange={(event) =>
                setAssignment({ ...assignment, residentId: event.target.value })
              }
              required
            >
              <option value="">เลือก Resident</option>
              {residents.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · PGY {person.pgy}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" disabled={Boolean(formBusy)}>
            {formBusy === "assign" ? "กำลังบันทึก…" : "บันทึกการมอบหมาย"}
          </button>
        </form>
      </div>
      {(message || error) && (
        <p className={error ? "form-error" : "form-success"}>
          {error || message}
        </p>
      )}
      <StaffDirectory
        staffDirectory={workspace.staffDirectory}
        onInvite={invite}
        busyEmail={busyEmail}
      />
      <section className="resident-panel">
        <h2>สถานะบัญชี</h2>
        <div className="resident-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>อีเมล</th>
                <th>บทบาท/PGY</th>
              </tr>
            </thead>
            <tbody>
              {workspace.profiles.map((person) => (
                <tr key={person.id}>
                  <td>{person.name}</td>
                  <td>{person.email}</td>
                  <td>
                    {person.pgy
                      ? `Resident · PGY ${person.pgy}`
                      : staffIds.has(person.id)
                        ? "Staff"
                        : "Admin"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function NavBadge({ count }) {
  if (!count) return null;
  return (
    <span className="nav-badge">
      {count > 99 ? "99+" : count}
      <span className="visually-hidden"> รายการ</span>
    </span>
  );
}

const navIcons = {
  home: HomeIcon,
  videos: BookIcon,
  schedule: CalendarIcon,
  accounts: KeyIcon,
  request: PlusIcon,
  pending: ClipboardIcon,
  scan: ScanIcon,
  dashboard: HomeIcon,
  qr: QrIcon,
  history: BookIcon,
  cases: BedIcon,
  conference: MicIcon,
  attendance: CheckIcon,
  "round-admin": CalendarIcon,
  notifications: BellIcon,
  exams: FileIcon,
  export: DownloadIcon,
  admin: KeyIcon,
};

export default function ResidentPlatform({ workspace, onRefresh, onLogout, renderModulePreview }) {
  const routeToken = parseResidentQrToken(window.location.pathname);
  // Read the attendance token once. RoundCheckIn clears it (and the URL) after
  // the first check-in so switching tabs or reloading never re-submits an
  // expired, rotating QR token.
  const [roundToken, setRoundToken] = useState(() => parseRoundToken(window.location.pathname));
  const initialTab =
    workspace.user.role !== "admin" && roundToken ? "attendance" : workspace.user.role === "staff" && routeToken ? "scan" : "home";
  const [tab, setTab] = useState(initialTab);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [historyFocus, setHistoryFocus] = useState("completed");
  const [presentCase, setPresentCase] = useState(null);
  const unreadCount = useMemo(
    () => workspace.notifications.filter((item) => !item.read_at).length,
    [workspace.notifications],
  );
  const nav = [
    ["home", "หน้าแรก"],
    ["dashboard", "ภาพรวม EPA / PBA"],
    ["history", "ผลการประเมิน"],
  ];
  if (workspace.user.role === "resident")
    nav.unshift(["request", "ส่งแบบประเมิน"]);
  if (workspace.user.role === "resident") nav.splice(2, 0, ["qr", "QR ของฉัน"]);
  if (workspace.user.role === "staff")
    nav.unshift(["pending", "รอประเมิน"], ["scan", "สแกน QR"]);
  if (workspace.user.role === "resident" || workspace.user.role === "staff")
    nav.push(["attendance", "เช็กชื่อประชุม"]);
  nav.push(["cases", "New admissions"], ["conference", "ประชุมวันศุกร์"]);
  nav.push(["notifications", "Notification"]);
  // Counts that need action are badges, not part of the label.
  const badges = {
    notifications: unreadCount,
    pending:
      workspace.user.role === "staff"
        ? workspace.requests.filter((item) => item.status === "pending").length
        : 0,
  };
  const quickNav = bottomNav(workspace.user.role, nav);
  if (workspace.user.role === "admin")
    nav.push(["round-admin", "MM & Grand Round"], ["exams", "การสอบ"], ["export", "Export ข้อมูล"], ["admin", "จัดการระบบ"]);
  else
    nav.push(["exams", workspace.user.role === "resident" ? "ผลการสอบของฉัน" : "ผลการสอบ"]);
  nav.push(["videos", "คลังวิดีโอ"], ["schedule", "ตารางเวร / OR"], ["accounts", "บัญชีที่เชื่อมต่อ"]);
  const titles = {
    home: "Resident Corner",
    videos: "คลังวิดีโอ",
    schedule: "ตารางเวร / ตาราง OR",
    accounts: "บัญชีที่เชื่อมต่อ",
    dashboard: "Dashboard การประเมิน",
    request: "ส่งแบบประเมิน EPA/PBA",
    pending: "รายการรอ Staff ประเมิน",
    scan: "สแกน QR เพื่อประเมิน",
    qr: "QR สำหรับ Staff",
    history:
      workspace.user.role === "staff"
        ? "ประวัติการประเมิน"
        : "ผลการประเมินของฉัน",
    notifications: "Notification",
    export: "Export ข้อมูลการประเมิน",
    admin: "จัดการระบบ Resident",
    attendance: "เช็กชื่อ MM & Grand Round",
    "round-admin": "MM & Grand Round",
    exams: workspace.user.role === "resident" ? "ผลการสอบของฉัน" : "การสอบ",
    cases: "New admissions",
    conference: "ประชุมวันศุกร์",
  };
  async function readNotification(id) {
    await markNotificationRead(id);
    await onRefresh();
  }
  function goTo(id) {
    if (id === "conference" && tab !== "conference") setPresentCase(null);
    setTab(id);
    setSelectedRequest(null);
    setMenuOpen(false);
  }
  const openScannedRequest = (request) => {
    setSelectedRequest(request);
    setTab("pending");
  };
  const navigate = (id) => {
    if (!nav.some(([allowed]) => allowed === id)) return;
    if (id === "conference" && tab !== "conference") setPresentCase(null);
    setTab(id);
    setSelectedRequest(null);
    setMenuOpen(false);
  };
  return (
    <div className="resident-app app-shell-v2 corner-shell">
      <aside className={`app-sidebar${menuOpen ? " open" : ""}`} aria-label="เมนูหลัก">
        <div className="app-sidebar-brand">
          <img src="/surgery-cmu-logo.png" alt="Surgery CMU" />
          <div>
            <strong>Resident Corner</strong>
            <span>ภาควิชาศัลยศาสตร์ มช.</span>
          </div>
          <button type="button" className="icon-button app-menu-close" onClick={() => setMenuOpen(false)} aria-label="ปิดเมนู"><XIcon /></button>
        </div>
        <nav className="app-nav" aria-label="เมนู Resident Corner">
          {groupNav(nav, workspace.user.role).map(([group, items]) => (
            <div className="app-nav-group" key={group}>
              <div className="app-nav-title">{group}</div>
              {items.map(([id, label]) => {
                const Icon = navIcons[id] || FileIcon;
                return (
                  <button
                    key={id}
                    type="button"
                    className={tab === id ? "active" : ""}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => navigate(id)}
                  >
                    <Icon size={19} />
                    <span>{label}</span>
                    <NavBadge count={badges[id]} />
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="app-sidebar-foot">SERVICE · LEARNING · TRAINING<br />ห้ามบันทึกข้อมูลระบุตัวผู้ป่วย</div>
      </aside>
      {menuOpen && <div className="app-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className="app-workspace">
        <div className="app-topbar">
          <button type="button" className="icon-button app-menu-button" onClick={() => setMenuOpen(true)} aria-label="เปิดเมนู" aria-expanded={menuOpen}><MenuIcon /></button>
          <div className="app-crumb">Resident Corner {tab !== "home" && <span>/ {titles[tab]}</span>}</div>
          <div className="app-user">
            <span className="header-user-name" title={workspace.user.name}>{workspace.user.name}</span>
            <span className="role-chip">{roleLabel[workspace.user.role]}</span>
            <button className="text-button" type="button" onClick={onLogout}>
              ออกจากระบบ
            </button>
          </div>
        </div>
      <main>
        <div className="page-heading">
          <div>
            <h1>{titles[tab]}</h1>
            <p>
              {workspace.user.name}
              {workspace.user.pgy ? ` · PGY ${workspace.user.pgy}` : ""}
            </p>
          </div>
        </div>
        {tab === "home" ? (
          <ResidentCornerHome workspace={workspace} onNavigate={navigate} onOpenRequest={openScannedRequest} />
        ) : tab === "schedule" ? (
          <ResidentSchedule user={workspace.user} onNavigate={navigate} />
        ) : ["videos", "accounts"].includes(tab) ? (
          <CornerService service={tab} onNavigate={navigate} />
        ) : renderModulePreview ? renderModulePreview(tab, () => navigate("home")) : tab === "dashboard" ? (
          <ResidentDashboard
            workspace={workspace}
            onNavigate={goTo}
            onOpenRequest={openScannedRequest}
            onNavigateHistory={(focus) => {
              setHistoryFocus(focus);
              setTab("history");
            }}
          />
        ) : tab === "cases" ? (
          <ResidentCases
            user={workspace.user}
            onPresent={(row) => {
              setPresentCase(row);
              setTab("conference");
            }}
          />
        ) : tab === "conference" ? (
          <ResidentConference key={presentCase?.id || "week"} user={workspace.user} initialCase={presentCase} />
        ) : tab === "export" ? (
          <ResidentExportCenter workspace={workspace} />
        ) : tab === "round-admin" ? (
          <RoundAdmin user={workspace.user} />
        ) : tab === "exams" ? (
          <ResidentExams workspace={workspace} onRefresh={onRefresh} />
        ) : tab === "attendance" ? (
          <RoundCheckIn
            token={roundToken}
            onTokenUsed={() => {
              setRoundToken("");
              window.history.replaceState({}, document.title, "/");
            }}
          />
        ) : tab === "qr" ? (
          <ResidentQrCard user={workspace.user} />
        ) : tab === "scan" ? (
          <StaffQrScanner
            workspace={workspace}
            initialToken={routeToken}
            onOpenRequest={openScannedRequest}
          />
        ) : tab === "admin" ? (
          <Admin workspace={workspace} onRefresh={onRefresh} />
        ) : tab === "request" ? (
          <>
            <ResidentRequestForm workspace={workspace} onSaved={onRefresh} />
            <ResidentRequestHistory workspace={workspace} onRefresh={onRefresh} />
          </>
        ) : tab === "pending" ? (
          selectedRequest ? (
            <StaffEvaluationForm
              request={selectedRequest}
              templates={workspace.templates}
              profiles={workspace.allProfiles || workspace.profiles}
              onSaved={async () => {
                setSelectedRequest(null);
                await onRefresh();
              }}
              onCancel={() => setSelectedRequest(null)}
            />
          ) : (
            <>
              {workspace.user.role === "staff" && (
                <StaffAvailabilityCard workspace={workspace} onSaved={onRefresh} />
              )}
              <RequestQueue
              requests={workspace.requests}
              profiles={workspace.allProfiles || workspace.profiles}
              onSelect={setSelectedRequest}
            />
            </>
          )
        ) : tab === "notifications" ? (
          <Notifications
            notifications={workspace.notifications}
            onRead={readNotification}
          />
        ) : (
          <AssessmentHistory
            workspace={workspace}
            staffFocus={historyFocus}
            onStaffFocus={setHistoryFocus}
          />
        )}
      </main>
      <footer>
        ข้อมูลการประเมินใช้เพื่อการศึกษาและการพัฒนาวิชาชีพ
        ห้ามบันทึกข้อมูลระบุตัวผู้ป่วย
      </footer>
      </div>
      <nav className="bottom-nav" aria-label="เมนูด่วน">
        {quickNav.map(([id, label]) => {
          const Icon = navIcons[id] || FileIcon;
          return (
            <button
              key={id}
              type="button"
              className={id === "scan" ? "bottom-nav-primary" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => goTo(id)}
            >
              <span className="bottom-nav-icon"><Icon size={22} /><NavBadge count={badges[id]} /></span>
              <span>{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-current={quickNav.some(([id]) => id === tab) ? undefined : "page"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <span className="bottom-nav-icon"><MenuIcon size={22} /></span>
          <span>เพิ่มเติม</span>
        </button>
      </nav>
    </div>
  );
}
