import { supabase } from './supabase';
export async function loadCalendar(from,to,admin=false,signal) {
  let query=supabase.rpc('list_resident_calendar_events',{p_from:from,p_to:to,p_admin:admin});
  if(signal) query=query.abortSignal(signal);
  const {data,error}=await query;
  if(error) throw error;
  if(!Array.isArray(data)) throw new Error('Invalid calendar response');
  return data;
}
export async function saveCalendar(id,version,payload) {
  const {data,error}=await supabase.rpc('save_resident_calendar_event',{p_id:id,p_expected_version:version,p_payload:payload});
  if(error) throw error;
  return data;
}
