const asTime = (value) => value ? new Date(value).getTime() : 0;

export function getResidentProfiles(workspace) {
  return workspace.profiles.filter((profile) => Number.isInteger(profile.pgy));
}

export function buildDashboard(workspace) {
  const residents = getResidentProfiles(workspace);
  const pending = workspace.requests.filter((request) => request.status === "pending");
  const completed = workspace.assessments.length;
  const activeStaff = workspace.staffDirectory.filter((staff) => staff.active && staff.auth_user_id).length;
  const typeTotals = ["EPA", "PBA"].map((type) => ({
    type,
    templates: workspace.templates.filter((template) => template.template_type === type).length,
    completed: workspace.assessments.filter((assessment) => assessment.resident_template_definitions?.template_type === type).length,
    pending: pending.filter((request) => request.resident_template_definitions?.template_type === type).length,
  }));
  const assessmentCount = new Map();
  const pendingCount = new Map();
  workspace.assessments.forEach((assessment) => assessmentCount.set(assessment.resident_id, (assessmentCount.get(assessment.resident_id) || 0) + 1));
  pending.forEach((request) => pendingCount.set(request.resident_id, (pendingCount.get(request.resident_id) || 0) + 1));
  const residentRows = residents.map((resident) => ({
    ...resident,
    completed: assessmentCount.get(resident.id) || 0,
    pending: pendingCount.get(resident.id) || 0,
  }));
  const recent = [
    ...workspace.requests.map((request) => ({ id: `request-${request.id}`, at: request.submitted_at, kind: "ส่งแบบประเมิน", code: request.resident_template_definitions?.template_code || "—", residentId: request.resident_id })),
    ...workspace.assessments.map((assessment) => ({ id: `assessment-${assessment.id}`, at: assessment.signed_at || assessment.created_at, kind: "Staff ประเมินแล้ว", code: assessment.resident_template_definitions?.template_code || "—", residentId: assessment.resident_id })),
  ].sort((a, b) => asTime(b.at) - asTime(a.at)).slice(0, 6);
  return { residents, pending, completed, activeStaff, typeTotals, residentRows, recent };
}

export function buildExportRecords(workspace) {
  const names = new Map(workspace.profiles.map((profile) => [profile.id, profile]));
  const requestsByAssessment = new Map(workspace.requests.filter((request) => request.assessment_id).map((request) => [request.assessment_id, request]));
  return workspace.assessments.map((assessment) => {
    const request = requestsByAssessment.get(assessment.id);
    const resident = names.get(assessment.resident_id);
    const staff = names.get(assessment.evaluator_id);
    return {
      id: assessment.id,
      assessmentDate: assessment.assessment_date,
      residentId: assessment.resident_id,
      residentName: resident?.name || "—",
      pgy: resident?.pgy || assessment.resident_pgy || "—",
      templateId: assessment.template_id,
      templateCode: assessment.resident_template_definitions?.template_code || "—",
      templateTitle: assessment.resident_template_definitions?.title || "—",
      templateType: assessment.resident_template_definitions?.template_type || "—",
      staffName: staff?.name || "—",
      activity: assessment.procedure_or_activity || request?.procedure_or_activity || "—",
      submittedAt: request?.submitted_at || "",
      assessedAt: assessment.signed_at || request?.assessed_at || "",
      outcome: assessment.overall_outcome || "—",
      comment: assessment.overall_comment || "",
      scores: (assessment.resident_assessment_scores || []).map((score) => ({
        code: score.resident_template_criteria?.criterion_code || "—",
        criterion: score.resident_template_criteria?.criterion_text || "—",
        score: score.score,
        comment: score.comment || "",
      })),
    };
  });
}

export function filterExportRecords(records, filters) {
  return records.filter((record) => {
    if (filters.scope === "resident-one" && record.residentId !== filters.residentId) return false;
    if (filters.scope === "template-one" && record.templateId !== filters.templateId) return false;
    if (filters.scope === "epa-all" && record.templateType !== "EPA") return false;
    if (filters.scope === "pba-all" && record.templateType !== "PBA") return false;
    if (filters.dateFrom && record.assessmentDate < filters.dateFrom) return false;
    if (filters.dateTo && record.assessmentDate > filters.dateTo) return false;
    return true;
  });
}
