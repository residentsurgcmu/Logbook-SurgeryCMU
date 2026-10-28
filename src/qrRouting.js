// Recognize only Resident Corner QR routes. Never navigate to a scanned host.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function qrDestination(value, bareKind = 'attendance') {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let kind, token;
  if (new RegExp(`^${UUID}$`, 'i').test(text)) {
    if (!['attendance', 'assessment'].includes(bareKind)) return null;
    kind = bareKind; token = text;
  } else {
    if (!text.startsWith('/') && !/^https?:\/\//i.test(text)) return null;
    let url;
    try { url = new URL(text, 'https://resident-corner.invalid'); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const match = url.pathname.match(new RegExp(`^/(attendance|evaluate)/(${UUID})/?$`, 'i'));
    if (!match) return null;
    kind = match[1].toLowerCase() === 'attendance' ? 'attendance' : 'assessment'; token = match[2];
  }
  token = token.toLowerCase();
  return { kind, token, path: `/${kind === 'attendance' ? 'attendance' : 'evaluate'}/${token}` };
}
