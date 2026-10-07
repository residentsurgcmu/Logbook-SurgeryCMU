import { supabase } from "./supabase";
export { EMBED_LINKS, embedAddressProblem, embedErrorMessage, embedHost } from "./embedLinkRules";

const fail = (error) => { if (error) throw new Error(error.message || "ทำรายการไม่สำเร็จ"); };

export async function loadEmbedLinks() {
  const { data, error } = await supabase.from("resident_embed_links").select("link_key,title,url,updated_at").order("link_key");
  fail(error);
  return data || [];
}

export async function setEmbedLink(key, title, url) {
  const { error } = await supabase.rpc("set_resident_embed_link", { p_key: key, p_title: title, p_url: url });
  fail(error);
}

export async function clearEmbedLink(key) {
  const { error } = await supabase.rpc("clear_resident_embed_link", { p_key: key });
  fail(error);
}
