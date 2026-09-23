import React, { useEffect, useMemo, useState } from "react";
import { completeAssessmentRequest, requestAssessment } from "../residentApi";

const localDate = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const dateLabel = (value) =>
  value
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeZone: "Asia/Bangkok",
      }).format(new Date(`${value}T12:00:00+07:00`))
    : "—";
const timeLabel = (value) =>
  value
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Bangkok",
      }).format(new Date(value))
    : "—";
const attemptLabel = (request, template) =>
  template?.max_attempts
    ? `ครั้งที่ ${request.attempt_number} จาก ${template.max_attempts}`
    : `ครั้งที่ ${request.attempt_number}`;

export function ScoreLegend({ template }) {
  return (
    <div className="score-legend" aria-label="ความหมายของระดับคะแนน">
      <span>
        <strong>{template?.template_type}</strong> ={" "}
        {template?.template_type === "EPA"
          ? "Entrustable Professional Activities"
          : "Procedure-Based Assessment"}
      </span>
      {(template?.score_legend || []).map(([code, meaning]) => (
        <span key={code}>
          <strong>{code}</strong> = {meaning}
        </span>
      ))}
    </div>
  );
}

export function ScoreGrid({
  template,
  scores,
  onScore,
  comments,
  onComment,
  selfScores,
}) {
  const selfByCriterion = new Map(
    (selfScores || []).map((row) => [row.criterion_id, row]),
  );
  return (
    <div
      className="criterion-list"
      style={{ "--score-count": template.score_options.length }}
    >
      <div className="criterion-head">
        <span>เกณฑ์ประเมิน</span>
        {template.score_options.map((score) => (
          <b key={score}>{score}</b>
        ))}
        <span>ข้อเสนอแนะ</span>
      </div>
      {template.criteria.map((criterion) => (
        <div className="criterion-row" key={criterion.id}>
          <div>
            <small>{criterion.criterion_code}</small>
            <p>{criterion.criterion_text}</p>
            {selfByCriterion.has(criterion.id) && (
              <small className="self-score-hint">
                Resident: {selfByCriterion.get(criterion.id).score}
                {selfByCriterion.get(criterion.id).comment
                  ? ` · ${selfByCriterion.get(criterion.id).comment}`
                  : ""}
              </small>
            )}
          </div>
          {template.score_options.map((score) => (
            <label className="score-radio" key={score}>
              <input
                type="radio"
                name={`score-${criterion.id}`}
                value={score}
                checked={scores[criterion.id] === score}
                onChange={() => onScore(criterion.id, score)}
              />
              <span>{score}</span>
            </label>
          ))}
          <input
            aria-label={`ข้อเสนอแนะ ${criterion.criterion_code}`}
            value={comments[criterion.id] || ""}
            onChange={(event) => onComment(criterion.id, event.target.value)}
            maxLength="1000"
            placeholder="ถ้ามี"
          />
        </div>
      ))}
    </div>
  );
}

export function OutcomeSelect({ template, value, onChange, label }) {
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <option value="">เลือกผลสรุป</option>
        {(template?.outcome_options || []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ResidentRequestForm({ workspace, onSaved }) {
  const { templates, registeredStaff, requests, user } = workspace;
  const [templateId, setTemplateId] = useState(templates[0]?.id || "");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(localDate());
  const [activity, setActivity] = useState("");
  const [context, setContext] = useState("");
  const [scores, setScores] = useState({});
  const [comments, setComments] = useState({});
  const [selfOutcome, setSelfOutcome] = useState("");
  const [selfComment, setSelfComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const template = templates.find((item) => item.id === templateId);
  const past = requests.filter(
    (item) => item.template_id === templateId && item.status !== "cancelled",
  );
  const pending = past.some((item) => item.status === "pending");
  const atLimit =
    template?.max_attempts != null && past.length >= template.max_attempts;
  const previous = [...past]
    .filter((item) => item.status === "completed")
    .sort((a, b) => b.attempt_number - a.attempt_number)[0];
  const previousStaff =
    previous &&
    (workspace.profiles.find((item) => item.id === previous.staff_id)?.name ||
      previous.previous_staff_name);
  async function submit(event) {
    event.preventDefault();
    if (!template || !staffId || !activity.trim())
      return setError("กรุณาเลือกแบบประเมิน Staff และชื่อกิจกรรม");
    if (
      template.requires_self_assessment &&
      template.criteria.some((criterion) => !scores[criterion.id])
    )
      return setError("กรุณาประเมินตนเองทุกข้อก่อนส่ง Staff");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestAssessment({
        templateId,
        staffId,
        date,
        context,
        activity,
        selfOutcome,
        selfComment,
        selfScores: template.requires_self_assessment
          ? template.criteria.map((criterion) => ({
              criterionId: criterion.id,
              score: scores[criterion.id],
              comment: comments[criterion.id] || "",
            }))
          : [],
      });
      setMessage(
        result.emailSent
          ? "ส่งแบบประเมินและอีเมลแจ้ง Staff แล้ว"
          : "ส่งแบบประเมินและ notification ในระบบแล้ว กรุณาตรวจสอบการแจ้งอีเมลกับ Admin",
      );
      setActivity("");
      setContext("");
      setScores({});
      setComments({});
      setSelfOutcome("");
      setSelfComment("");
      await onSaved();
    } catch (nextError) {
      setError(nextError.message || "ส่งแบบประเมินไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  if (!templates.length)
    return (
      <section className="resident-panel empty">
        <h2>ยังไม่มีแบบประเมิน</h2>
      </section>
    );
  return (
    <form className="resident-panel assessment-form" onSubmit={submit}>
      <div className="section-heading">
        <h2>ส่งแบบประเมินให้ Staff</h2>
        <p>
          เลือก Staff ที่ลงทะเบียนในระบบและประเมินตนเองก่อนส่งเมื่อแบบฟอร์มกำหนด
        </p>
      </div>
      <div className="resident-form-grid">
        <label>
          แบบประเมิน
          <select
            value={templateId}
            onChange={(event) => {
              setTemplateId(event.target.value);
              setScores({});
              setComments({});
              setSelfOutcome("");
            }}
            required
          >
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.template_code} · {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Staff ผู้ประเมิน
          <select
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
            required
          >
            <option value="">เลือก Staff</option>
            {registeredStaff.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {person.full_name} · {person.unit_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          วันที่ทำกิจกรรม
          <input
            type="date"
            value={date}
            max={localDate()}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        <label>
          ชื่อกิจกรรม/หัตถการ
          <input
            value={activity}
            onChange={(event) => setActivity(event.target.value)}
            maxLength="240"
            required
          />
        </label>
        <label className="wide">
          บริบททางคลินิกแบบไม่ระบุตัวตน
          <textarea
            value={context}
            onChange={(event) => setContext(event.target.value)}
            maxLength="500"
            rows="2"
            placeholder="ห้ามระบุข้อมูลผู้ป่วย"
          />
        </label>
      </div>
      {template && (
        <>
          <p className="attempt-note">
            {template.max_attempts
              ? `การประเมินครั้งที่ ${past.length + 1} จาก ${template.max_attempts}`
              : `การประเมินครั้งที่ ${past.length + 1}`}
            {previousStaff ? ` · ครั้งก่อนประเมินโดย ${previousStaff}` : ""}
          </p>
          {template.template_type === "PBA" && (
            <p className="source-note">
              {(template.recommended_pgy || []).includes(user.pgy)
                ? `แนะนำสำหรับ PGY ${user.pgy}`
                : `แบบนี้ไม่ได้อยู่ในรายการแนะนำของ PGY ${user.pgy} แต่ยังเลือกประเมินได้`}{" "}
              · แนวทาง PBA แนะนำอย่างน้อย 4 หัตถการที่แตกต่างกัน
            </p>
          )}
          <ScoreLegend template={template} />
          {template.requires_self_assessment && (
            <section className="self-assessment-section">
              <h3>Resident ประเมินตนเอง</h3>
              <p>ผลนี้จะให้ Staff ที่เลือกเห็นก่อนประเมิน</p>
              <ScoreGrid
                template={template}
                scores={scores}
                onScore={(id, score) =>
                  setScores((current) => ({ ...current, [id]: score }))
                }
                comments={comments}
                onComment={(id, value) =>
                  setComments((current) => ({ ...current, [id]: value }))
                }
              />
              <div className="resident-form-grid footer-fields">
                <OutcomeSelect
                  template={template}
                  label="ผลสรุปของ Resident"
                  value={selfOutcome}
                  onChange={setSelfOutcome}
                />
                <label className="wide">
                  ความเห็นของ Resident
                  <textarea
                    value={selfComment}
                    onChange={(event) => setSelfComment(event.target.value)}
                    maxLength="2000"
                    rows="3"
                  />
                </label>
              </div>
            </section>
          )}
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-success">{message}</p>}
      <button
        className="primary-button"
        disabled={busy || pending || atLimit || !registeredStaff.length}
      >
        {busy
          ? "กำลังส่ง…"
          : pending
            ? "มีคำขอรอประเมินอยู่"
            : atLimit
              ? "ครบจำนวนครั้งแล้ว"
              : "ส่งให้ Staff ประเมิน"}
      </button>
    </form>
  );
}

export function StaffEvaluationForm({
  request,
  templates,
  profiles,
  onSaved,
  onCancel,
}) {
  const [outcome, setOutcome] = useState("");
  const [comment, setComment] = useState("");
  const [scores, setScores] = useState({});
  const [comments, setComments] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const template = templates.find((item) => item.id === request.template_id);
  const resident = profiles.find((item) => item.id === request.resident_id);
  async function submit(event) {
    event.preventDefault();
    if (template.criteria.some((criterion) => !scores[criterion.id]))
      return setError("กรุณาเลือกระดับทุกข้อก่อนลงนาม");
    setBusy(true);
    setError("");
    try {
      await completeAssessmentRequest({
        requestId: request.id,
        outcome,
        comment,
        scores: template.criteria.map((criterion) => ({
          criterionId: criterion.id,
          score: scores[criterion.id],
          comment: comments[criterion.id] || "",
        })),
      });
      await onSaved();
    } catch (nextError) {
      setError(nextError.message || "บันทึกผลประเมินไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  if (!template)
    return <section className="resident-panel empty">ไม่พบแบบประเมิน</section>;
  return (
    <form className="resident-panel assessment-form" onSubmit={submit}>
      <div className="section-heading">
        <h2>
          {template.template_code} · {template.title}
        </h2>
        <p>
          Resident: {resident?.name || "—"} · PGY {resident?.pgy || "—"} ·{" "}
          {attemptLabel(request, template)} · ส่งเมื่อ{" "}
          {timeLabel(request.submitted_at)}
        </p>
      </div>
      <div className="request-summary">
        <div>
          <small>วันที่กิจกรรม</small>
          <strong>{dateLabel(request.assessment_date)}</strong>
        </div>
        <div>
          <small>กิจกรรม</small>
          <strong>{request.procedure_or_activity}</strong>
        </div>
        {request.previous_staff_name && (
          <div>
            <small>ครั้งก่อนประเมินโดย</small>
            <strong>{request.previous_staff_name}</strong>
          </div>
        )}
      </div>
      <ScoreLegend template={template} />
      {template.requires_self_assessment && (
        <section className="self-assessment-section">
          <h3>ผลประเมินตนเองของ Resident</h3>
          <p>
            ส่งเมื่อ {timeLabel(request.self_submitted_at)} · ผลสรุป{" "}
            {request.self_overall_outcome || "—"}
          </p>
          {request.self_comment && <p>{request.self_comment}</p>}
        </section>
      )}
      <ScoreGrid
        template={template}
        scores={scores}
        onScore={(id, score) =>
          setScores((current) => ({ ...current, [id]: score }))
        }
        comments={comments}
        onComment={(id, value) =>
          setComments((current) => ({ ...current, [id]: value }))
        }
        selfScores={request.resident_self_assessment_scores}
      />
      <div className="resident-form-grid footer-fields">
        <OutcomeSelect
          template={template}
          label="ผลสรุปของ Staff"
          value={outcome}
          onChange={setOutcome}
        />
        <label className="wide">
          ความเห็นของ Staff
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength="2000"
            rows="3"
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="button-row">
        <button className="primary-button" disabled={busy}>
          {busy ? "กำลังบันทึก…" : "ลงนามและบันทึกผล"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel}>
          กลับ
        </button>
      </div>
    </form>
  );
}

export function ResidentRequestHistory({ workspace }) {
  const names = new Map(
    workspace.profiles.map((person) => [person.id, person.name]),
  );
  if (!workspace.requests.length) return null;
  return (
    <section className="resident-panel">
      <h2>สถานะแบบประเมินที่ส่ง</h2>
      <div className="resident-table-wrap">
        <table>
          <thead>
            <tr>
              <th>ส่งเมื่อ</th>
              <th>แบบประเมิน</th>
              <th>ครั้งที่</th>
              <th>Staff</th>
              <th>ครั้งก่อน</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {workspace.requests.map((request) => (
              <tr key={request.id}>
                <td>{timeLabel(request.submitted_at)}</td>
                <td>
                  {request.resident_template_definitions?.template_code} ·{" "}
                  {request.procedure_or_activity}
                </td>
                <td>{request.attempt_number}</td>
                <td>{names.get(request.staff_id) || "—"}</td>
                <td>{request.previous_staff_name || "—"}</td>
                <td>
                  {request.status === "completed" ? "ประเมินแล้ว" : "รอประเมิน"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AssessmentHistory({
  workspace,
  staffFocus = "completed",
  onStaffFocus,
}) {
  const { assessments, requests, profiles, templates, user } = workspace;
  const [pgy, setPgy] = useState("");
  const [residentId, setResidentId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (user.role === "staff")
      document
        .getElementById(`staff-history-${staffFocus}`)
        ?.scrollIntoView({ block: "start" });
  }, [staffFocus, user.role]);
  const profileById = useMemo(
    () => new Map(profiles.map((person) => [person.id, person])),
    [profiles],
  );
  const relatedIds = new Set([
    ...requests.map((request) => request.resident_id),
    ...assessments.map((item) => item.resident_id),
  ]);
  const related = [...relatedIds]
    .map((id) => profileById.get(id))
    .filter(Boolean)
    .filter((person) => !pgy || String(person.pgy) === pgy);
  const visible = assessments.filter(
    (item) =>
      (!pgy || String(item.resident_pgy) === pgy) &&
      (!residentId || item.resident_id === residentId) &&
      (!templateId || item.template_id === templateId),
  );
  const byAssessment = new Map(
    requests
      .filter((request) => request.assessment_id)
      .map((request) => [request.assessment_id, request]),
  );
  const chooseResident = (id) => {
    setResidentId(id);
    onStaffFocus?.("completed");
    setSelected(null);
  };
  if (selected) {
    const template = templates.find((item) => item.id === selected.template_id);
    const request = byAssessment.get(selected.id);
    return (
      <section className="resident-panel">
        <button
          className="secondary-button"
          type="button"
          onClick={() => setSelected(null)}
        >
          กลับไปประวัติ
        </button>
        <h2>
          {template?.template_code} · {template?.title}
        </h2>
        <p>
          {profileById.get(selected.resident_id)?.name || "—"} · PGY{" "}
          {selected.resident_pgy} · {timeLabel(selected.signed_at)} ·{" "}
          {request && attemptLabel(request, template)}
        </p>
        {request?.previous_staff_name && (
          <p>ครั้งก่อนประเมินโดย {request.previous_staff_name}</p>
        )}
        <ScoreLegend template={template} />
        {request?.self_submitted_at && (
          <div className="self-assessment-section">
            <h3>Resident ประเมินตนเอง · {request.self_overall_outcome}</h3>
            {request.self_comment && <p>{request.self_comment}</p>}
          </div>
        )}
        <div className="resident-table-wrap">
          <table>
            <thead>
              <tr>
                <th>เกณฑ์</th>
                {request?.self_submitted_at && <th>Resident</th>}
                <th>Staff</th>
              </tr>
            </thead>
            <tbody>
              {(template?.criteria || []).map((criterion) => {
                const self = request?.resident_self_assessment_scores?.find(
                  (row) => row.criterion_id === criterion.id,
                );
                const staff = selected.resident_assessment_scores?.find(
                  (row) => row.criterion_id === criterion.id,
                );
                return (
                  <tr key={criterion.id}>
                    <td>{criterion.criterion_text}</td>
                    {request?.self_submitted_at && (
                      <td>
                        {self?.score || "—"}
                        {self?.comment && <p>{self.comment}</p>}
                      </td>
                    )}
                    <td>
                      {staff?.score || "—"}
                      {staff?.comment && <p>{staff.comment}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          <strong>ผลสรุป Staff:</strong> {selected.overall_outcome || "—"}{" "}
          {selected.overall_comment}
        </p>
      </section>
    );
  }
  return (
    <div className="dashboard-stack">
      {user.role === "staff" && (
        <section className="resident-panel" id="staff-history-related">
          <h2>Resident ที่เกี่ยวข้อง</h2>
          <div className="history-filters">
            <label>
              ชั้นปี
              <select
                value={pgy}
                onChange={(event) => {
                  setPgy(event.target.value);
                  setResidentId("");
                }}
              >
                <option value="">ทุกชั้นปี</option>
                {[1, 2, 3, 4].map((year) => (
                  <option key={year} value={year}>
                    PGY {year}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {related.length ? (
            <div className="related-residents">
              {related.map((person) => (
                <button
                  className="related-resident"
                  key={person.id}
                  type="button"
                  onClick={() => chooseResident(person.id)}
                >
                  <strong>{person.name}</strong>
                  <span>
                    PGY {person.pgy} · รอ{" "}
                    {
                      requests.filter(
                        (request) =>
                          request.resident_id === person.id &&
                          request.status === "pending",
                      ).length
                    }{" "}
                    · ประเมินแล้ว{" "}
                    {
                      assessments.filter(
                        (item) => item.resident_id === person.id,
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-empty">ไม่พบ Resident ที่เกี่ยวข้อง</p>
          )}
        </section>
      )}
      <section className="resident-panel" id="staff-history-completed">
        <h2>{user.role === "staff" ? "ฉันประเมินแล้ว" : "ผลการประเมิน"}</h2>
        <div className="history-filters">
          <label>
            ชั้นปี
            <select
              value={pgy}
              onChange={(event) => {
                setPgy(event.target.value);
                setResidentId("");
              }}
            >
              <option value="">ทุกชั้นปี</option>
              {[1, 2, 3, 4].map((year) => (
                <option key={year} value={year}>
                  PGY {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            Resident
            <select
              value={residentId}
              onChange={(event) => setResidentId(event.target.value)}
            >
              <option value="">ทุกคน</option>
              {related.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            หัวข้อ EPA/PBA
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">ทุกหัวข้อ</option>
              {["EPA", "PBA"].map((type) => (
                <optgroup label={type} key={type}>
                  {templates
                    .filter((item) => item.template_type === type)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.template_code} · {item.title}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setPgy("");
              setResidentId("");
              setTemplateId("");
            }}
          >
            ล้างตัวกรอง
          </button>
        </div>
        {visible.length ? (
          <div className="resident-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>Resident</th>
                  <th>PGY</th>
                  <th>แบบประเมิน</th>
                  <th>ครั้งที่</th>
                  <th>ผล Staff</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const request = byAssessment.get(item.id);
                  return (
                    <tr key={item.id}>
                      <td>{dateLabel(item.assessment_date)}</td>
                      <td>{profileById.get(item.resident_id)?.name || "—"}</td>
                      <td>{item.resident_pgy}</td>
                      <td>
                        {item.resident_template_definitions?.template_code} ·{" "}
                        {item.resident_template_definitions?.title}
                      </td>
                      <td>{request?.attempt_number || "—"}</td>
                      <td>{item.overall_outcome || "—"}</td>
                      <td>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setSelected(item)}
                        >
                          ดูรายละเอียด
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-empty">ไม่พบผลการประเมินตามตัวกรอง</p>
        )}
      </section>
    </div>
  );
}
