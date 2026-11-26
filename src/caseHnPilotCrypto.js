const allowedHost = "dyiiivcyoatgmkmvgcnt.supabase.co";
export function isCaseHnPilotEnabled(flag, url, pinnedKeyId) {
  if (flag !== "true" || typeof pinnedKeyId !== "string" || !/^[0-9a-f]{64}$/.test(pinnedKeyId)) return false;
  try { return new URL(url).origin === `https://${allowedHost}`; } catch { return false; }
}
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const kidPattern = /^[0-9a-f]{64}$/;
const codePattern = /^ADM-[0-9]{5}$/;
export const isCaseHn = (value) => typeof value === "string" && value.length === 7 && /^[0-9]{7}$/.test(value);
const encoder = new TextEncoder();
const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export async function sealPilotHn({ publicKey, configuredKey, caseUuid, caseCode, hn, cryptoApi = globalThis.crypto }) {
  if (!isCaseHn(hn) || !idPattern.test(caseUuid) || !codePattern.test(caseCode)
      || !kidPattern.test(configuredKey) || publicKey?.format !== "rc-hn-prod-v1"
      || publicKey.type !== "public" || publicKey.keyId !== configuredKey
      || typeof publicKey.spki !== "string" || !/^[A-Za-z0-9+/]{500,600}={0,2}$/.test(publicKey.spki)) throw Error("Invalid HN input");
  const spki = Uint8Array.from(atob(publicKey.spki), (c) => c.charCodeAt(0));
  const fingerprint = Array.from(new Uint8Array(await cryptoApi.subtle.digest("SHA-256", spki)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (fingerprint !== configuredKey) throw Error("Invalid HN key");
  const key = await cryptoApi.subtle.importKey("spki", spki, {name:"RSA-OAEP", hash:"SHA-256"}, false, ["encrypt"]);
  if (key.algorithm.modulusLength !== 3072) throw Error("Invalid HN key size");
  const input = encoder.encode(hn);
  try {
    const label = encoder.encode(`rc-hn-prod-v1:${caseUuid}:${caseCode}:${configuredKey}`);
    return { keyId: configuredKey, ciphertext: toB64(await cryptoApi.subtle.encrypt({name:"RSA-OAEP", label}, key, input)) };
  } finally {
    input.fill(0);
  }
}
