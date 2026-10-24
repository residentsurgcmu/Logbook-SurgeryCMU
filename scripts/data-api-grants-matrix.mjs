import assert from 'node:assert/strict';

// Independent acceptance inventory. Do not derive this list or its count from
// the SQL result: a missing UNION/VALUES branch must fail before any PASS line.
const required = [
  'authenticated resident_user_roles SELECT',
  'authenticated resident_profiles SELECT',
  'authenticated resident_template_definitions SELECT,INSERT,UPDATE',
  'authenticated resident_template_criteria SELECT,INSERT,UPDATE',
  'authenticated resident_evaluator_assignments SELECT,INSERT,UPDATE',
  'authenticated resident_assessments SELECT',
  'authenticated resident_assessment_scores SELECT',
  'authenticated resident_assessment_requests SELECT',
  'authenticated resident_notifications SELECT',
  'authenticated resident_self_assessment_scores SELECT',
  'authenticated resident_round_sessions SELECT',
  'authenticated resident_round_attendance SELECT',
  'authenticated resident_round_cme_qr SELECT',
  'authenticated resident_exam_events SELECT',
  'authenticated resident_exam_participants SELECT',
  'authenticated resident_exam_parts SELECT',
  'authenticated resident_exam_results SELECT',
  'authenticated resident_exam_standards SELECT',
  'authenticated resident_exam_standard_mpl SELECT',
  'authenticated resident_exam_mpl SELECT',
  'authenticated resident_admission_cases SELECT',
  'authenticated resident_case_media SELECT',
  'authenticated resident_case_notes SELECT',
  'authenticated resident_conference_sessions SELECT',
  'authenticated resident_embed_links SELECT',
  'authenticated resident_room_layouts SELECT',
  'authenticated resident_room_seats SELECT',
  'service_role resident_user_roles SELECT',
  'service_role resident_profiles SELECT',
  'service_role resident_template_definitions SELECT',
  'service_role resident_staff_directory SELECT',
  'service_role resident_assessment_requests SELECT',
  'service_role resident_notifications SELECT,INSERT,UPDATE',
  'service_role resident_assessment_email_deliveries SELECT,UPDATE',
];
const internal = [
  'rc04_exam_revisions', 'rc04_revision_parts', 'rc04_revision_mpl',
  'rc04_revision_participants', 'rc04_revision_results', 'rc04_import_previews',
  'rc04_import_batches', 'rc04_request_receipts', 'rc04_audit', 'rc04_read_manifests',
];
export const EXPECTED_MATRIX_NAMES = Object.freeze([
  ...required.map(name => `required ${name}`),
  ...internal.map(name => `closed all client table/column privileges ${name}`),
  'closed authenticated account writes resident_profiles',
  'closed authenticated account writes resident_user_roles',
  'notification read_at UPDATE available',
  'notification other columns not writable',
].sort());
assert.equal(EXPECTED_MATRIX_NAMES.length, 48, 'Acceptance inventory must contain 48 checks');
assert.equal(new Set(EXPECTED_MATRIX_NAMES).size, 48, 'Acceptance inventory must be unique');

export function validateGrantsMatrix(rows) {
  assert.ok(Array.isArray(rows), 'Matrix must return an array');
  assert.equal(rows.length, 48, 'Matrix must return exactly 48 checks');
  assert.deepEqual(rows.map(row => row?.check_name).sort(), EXPECTED_MATRIX_NAMES,
    'Matrix must contain every expected check exactly once, with no unknown names');
  for (const row of rows) assert.equal(row.ok, true, `Matrix check failed: ${row.check_name}`);
  return rows;
}
