const ccmeAttendeeLink = /^https:\/\/score\.ccme\.or\.th\/event\/[a-z0-9_-]+\/audience\/join\/?$/i;

export function roundCmeAttendeeUrl(value) {
  const url = typeof value === "string" ? value.trim() : "";
  return url.length <= 512 && ccmeAttendeeLink.test(url) ? url : "";
}

const ccmeSpeakerLink = /^https:\/\/score\.ccme\.or\.th\/event\/[a-z0-9_-]+\/speaker\/join\/?$/i;

export function roundCmeSpeakerUrl(value) {
  const url = typeof value === "string" ? value.trim() : "";
  return url.length <= 512 && ccmeSpeakerLink.test(url) ? url : "";
}

export async function decodeRoundCmeQr(file, kind = "attendee") {
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
  const target = document.createElement("div");
  target.id = `round-cme-reader-${crypto.randomUUID()}`;
  target.hidden = true;
  document.body.append(target);
  try {
    const scanner = new Html5Qrcode(target.id, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    const text = await scanner.scanFile(file, false);
    if (kind === "speaker") return roundCmeSpeakerUrl(text);
    // Leave the raw recognition inside the browser; only an attendee URL is returned.
    if (roundCmeSpeakerUrl(text)) throw new Error("ภาพนี้เป็น QR สำหรับผู้บรรยาย");
    return roundCmeAttendeeUrl(text);
  } finally {
    target.remove();
  }
}
