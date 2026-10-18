import { accountPreviewValid } from "./adminAccounts.js";

export function createAdminAccountsApi(client) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    if (data == null) throw new Error("Incomplete account response");
    return data;
  }
  // Table-returning RPCs keep their deterministic database ordering on every page.
  async function rows(name, args) {
    const all = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.rpc(name, args).range(offset, offset + 999);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Incomplete account list response");
      all.push(...data);
      if (data.length < 1000) return all;
    }
  }
  return {
    listAdminAccounts: () => rows("admin_list_accounts"),
    listAdminAccountEvents: (userId) => rows("admin_list_account_events", { p_user_id: userId }),
    async previewAdminAccountAction(userId, action) {
      const data = await rpc("admin_preview_account_action", { p_user_id: userId, p_action: action });
      if (!accountPreviewValid(data, userId, action)) throw new Error("Incomplete account preview response");
      return data;
    },
    async updateAdminAccount({ userId, updatedAt, requestId, changes, reason }) {
      const data = await rpc("admin_update_account", { p_user_id: userId, p_expected_updated_at: updatedAt, p_request_id: requestId, p_changes: changes, p_reason: reason });
      if (data.user_id !== userId || typeof data.updated_at !== "string" || typeof data.changed !== "boolean") throw new Error("Incomplete account update response");
      return data;
    },
    async setAdminAccountActive({ userId, active, updatedAt, requestId, reason, previewCounts }) {
      const data = await rpc("admin_set_account_active", { p_user_id: userId, p_active: active, p_expected_updated_at: updatedAt, p_request_id: requestId, p_reason: reason, p_preview_counts: previewCounts || null });
      if (data.user_id !== userId || data.active !== active || typeof data.updated_at !== "string") throw new Error("Incomplete account status response");
      return data;
    },
  };
}
