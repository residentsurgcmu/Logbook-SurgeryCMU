import { supabase } from "./supabase";

// Every seat-map read and write is one database function; nothing here touches a table directly.
async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const listSeatSessions = async () => (await call("list_resident_seat_sessions")) || [];
export const loadSeatMap = (sessionId) => call("get_resident_seat_map", { p_session_id: sessionId });
export const loadMySeatEvents = async (sessionId) => (await call("get_my_seat_events", { p_session_id: sessionId })) || [];

export const holdSeat = (sessionId, seatCode) => call("hold_resident_seat", { p_session_id: sessionId, p_seat_code: seatCode });
export const confirmSeat = (sessionId, seatCode) => call("confirm_resident_seat", { p_session_id: sessionId, p_seat_code: seatCode });
export const releaseSeat = (sessionId) => call("release_resident_seat", { p_session_id: sessionId });
export const moveToReserveArea = (sessionId) => call("use_reserve_area", { p_session_id: sessionId });
export const reportUrgentDuty = (sessionId, reason, note) => call("report_urgent_duty", { p_session_id: sessionId, p_reason: reason, p_note: note || null });
export const requestSeatCorrection = (sessionId, note) => call("request_seat_correction", { p_session_id: sessionId, p_note: note });

export const staffSetSeat = (sessionId, residentId, seatCode) => call("staff_set_resident_seat", { p_session_id: sessionId, p_resident_id: residentId, p_seat_code: seatCode });
export const staffReleaseSeat = (sessionId, residentId) => call("staff_release_resident_seat", { p_session_id: sessionId, p_resident_id: residentId });
export const certifySeatMap = (sessionId) => call("certify_seat_map", { p_session_id: sessionId });

export const adminConfigureSeat = async (sessionId, layoutId = null, onTimeAt = null) => (await call("admin_configure_seat_session", { p_session_id: sessionId, p_layout_id: layoutId, p_on_time_at: onTimeAt }))?.[0] || null;
export const reviewSeatRequest = (requestId, decision) => call("review_seat_request", { p_request_id: requestId, p_decision: decision });
export const listSeatRequests = async (sessionId) => (await call("list_seat_requests", { p_session_id: sessionId })) || [];
export const adminListSeatConfigs = async () => (await call("admin_list_seat_configs")) || [];
export const adminSeatReport = (sessionId) => call("admin_seat_report", { p_session_id: sessionId });
