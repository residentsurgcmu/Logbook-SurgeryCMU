import React, { useMemo, useState } from "react";
import { CheckIcon } from "../components/Icons";

const today = () => new Date().toISOString().slice(0, 10);

export default function Assessments({ type, user, fellowName, templates, assessments, onSave }) {
  const [selectedId, setSelectedId] = useState(templates[0].id);
  const [date, setDate] = useState(today());
  const [caseRef, setCaseRef] = useState("");
  const [supervisorName, setSupervisorName] = useState(user.role === "staff" ? user.name : "");
  const [scores, setScores] = useState({});
  const [itemComments, setItemComments] = useState({});
  const [globalLevel, setGlobalLevel] = useState("");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const template = useMemo(() => templates.find((item) => item.id === selectedId), [selectedId, templates]);
  const canEdit = user.role === "staff";
  const items = type === "EPA" ? template.items.map((item) => ({ section: "หัวข้อประเมิน", item })) : Object.entries(template.sections).flatMap(([section, sectionItems]) => sectionItems.map((item) => ({ section, item })));
  const scoreOptions = type === "EPA" ? ["1", "2", "3", "4", "5"] : ["N", "U", "S"];
  const checklistGrid = { gridTemplateColumns: `minmax(300px, 1fr) repeat(${scoreOptions.length}, 52px) minmax(160px, .55fr)` };

  async function save(event) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true); setError("");
    try {
      await onSave({ type, templateId: template.id, templateTitle: template.title, date, caseRef, supervisorName, scores, itemComments, globalLevel, comments });
      setScores({}); setItemComments({}); setGlobalLevel(""); setComments(""); setCaseRef("");
    } catch (nextError) {
      setError(nextError.message || "ไม่สามารถบันทึกผลการประเมินได้");
    } finally {
      setSaving(false);
    }
  }

  function selectTemplate(id) {
    setSelectedId(id); setScores({}); setItemComments({}); setGlobalLevel(""); setError("");
  }

  return (
    <>
      <div className="page-heading"><div><h1>{type}</h1><p>{type === "EPA" ? "Entrustable Professional Activities · 7 แบบประเมิน" : "Procedure-Based Assessment · 3 แบบประเมิน"}</p></div><span className="role-note">{canEdit ? "Staff เท่านั้นที่ประเมินและบันทึกได้" : "Fellow ดูผลการประเมินได้เท่านั้น"}</span></div>
      <div className="assessment-layout">
        <aside className="template-list">{templates.map((item) => <button key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => selectTemplate(item.id)}><strong>{item.id}</strong><span>{item.title}</span></button>)}</aside>
        <form className="content-panel assessment-form" onSubmit={save}>
          <div className="assessment-title"><span>{template.id}</span><div><h2>{template.title}</h2><p>ผู้รับการประเมิน: {fellowName}</p></div></div>
          <fieldset disabled={!canEdit || saving}>
            <div className="form-grid assessment-meta">
              <label>วันที่ประเมิน<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
              <label>Case / HN / Activity reference<input value={caseRef} onChange={(e) => setCaseRef(e.target.value)} placeholder="ระบุเท่าที่จำเป็น" /></label>
              <label className="span-2">ชื่ออาจารย์ผู้ควบคุม / ผู้ประเมิน<input value={supervisorName} onChange={(e) => setSupervisorName(e.target.value)} placeholder="ชื่ออาจารย์" required /></label>
            </div>
            <div className="checklist-table">
              <div className="checklist-row checklist-head" style={checklistGrid}><span>Competency / definition</span>{scoreOptions.map((score) => <span key={score}>{score}</span>)}<span>Comments</span></div>
              {items.map(({ section, item }, index) => (
                <React.Fragment key={`${section}-${item}`}>
                  {(index === 0 || items[index - 1].section !== section) && <div className="checklist-section">{section}</div>}
                  <div className="checklist-row" style={checklistGrid}>
                    <span>{item}</span>
                    {scoreOptions.map((score) => <label key={score} className="radio-cell"><input type="radio" name={`score-${index}`} value={score} checked={scores[index] === score} onChange={() => setScores({ ...scores, [index]: score })} required={canEdit} /><i><CheckIcon size={13} /></i></label>)}
                    <label className="item-comment"><input aria-label={`ข้อเสนอแนะ ${item}`} value={itemComments[index] || ""} onChange={(e) => setItemComments({ ...itemComments, [index]: e.target.value })} placeholder="ถ้ามี" /></label>
                  </div>
                </React.Fragment>
              ))}
            </div>
            <div className="global-score"><label>Global summary / ระดับศักยภาพ<select value={globalLevel} onChange={(e) => setGlobalLevel(e.target.value)} required><option value="">เลือกระดับ</option>{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>Level {level}</option>)}</select></label><label>ข้อเสนอแนะสรุป<textarea rows="4" value={comments} onChange={(e) => setComments(e.target.value)} placeholder="ข้อเสนอแนะจากอาจารย์ผู้ประเมิน" /></label></div>
          </fieldset>
          {error && <div className="form-error assessment-error" role="alert">{error}</div>}
          {canEdit && <div className="form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกการประเมิน"}</button></div>}
        </form>
      </div>
      <section className="content-panel assessment-history"><h2>ประวัติการประเมิน</h2>{assessments.length === 0 ? <p className="muted">ยังไม่มีผลการประเมิน</p> : <div className="data-table-wrap"><table><thead><tr><th>วันที่</th><th>แบบประเมิน</th><th>ระดับ</th><th>อาจารย์ผู้ควบคุม</th><th>ผู้บันทึก</th><th>ข้อเสนอแนะ</th></tr></thead><tbody>{assessments.map((item) => <tr key={item.id}><td>{item.date}</td><td>{item.templateId} · {item.templateTitle}</td><td>Level {item.globalLevel}</td><td>{item.supervisorName}</td><td>{item.assessor}</td><td>{item.comments || "—"}</td></tr>)}</tbody></table></div>}</section>
    </>
  );
}
