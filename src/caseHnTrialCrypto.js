const allowedHost = "vijxiststybmuchcghux.supabase.co";
export function isCaseHnTrialEnabled(flag, url) {
  if (flag !== "true") return false;
  try { return new URL(url).origin === `https://${allowedHost}`; } catch { return false; }
}
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const kidPattern = /^[0-9a-f]{64}$/;
const codePattern = /^ADM-[0-9]{5}$/;
export const isSyntheticCaseHn = (value) => typeof value === "string" && value.length === 12 && /^DEMO-[0-9]{7}$/.test(value);
const encoder = new TextEncoder();
const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export async function sealTrialHn({ publicKey, configuredKey, caseUuid, caseCode, hn, cryptoApi = globalThis.crypto }) {
  if (!isSyntheticCaseHn(hn) || !idPattern.test(caseUuid) || !codePattern.test(caseCode)
      || !kidPattern.test(configuredKey) || publicKey?.format !== "rc-hn-demo-v1"
      || publicKey.type !== "public" || publicKey.keyId !== configuredKey
      || typeof publicKey.spki !== "string" || !/^[A-Za-z0-9+/]{500,600}={0,2}$/.test(publicKey.spki)) throw Error("Invalid trial input");
  const spki = Uint8Array.from(atob(publicKey.spki), (c) => c.charCodeAt(0));
  const fingerprint = Array.from(new Uint8Array(await cryptoApi.subtle.digest("SHA-256", spki)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (fingerprint !== configuredKey) throw Error("Invalid trial key");
  const key = await cryptoApi.subtle.importKey("spki", spki, {name:"RSA-OAEP", hash:"SHA-256"}, false, ["encrypt"]);
  if (key.algorithm.modulusLength !== 3072) throw Error("Invalid trial key size");
  const input = encoder.encode(hn);
  try {
    const label = encoder.encode(`rc-hn-trial-v1:${caseUuid}:${caseCode}:${configuredKey}`);
    return { keyId: configuredKey, ciphertext: toB64(await cryptoApi.subtle.encrypt({name:"RSA-OAEP", label}, key, input)) };
  } finally {
    input.fill(0);
  }
}
