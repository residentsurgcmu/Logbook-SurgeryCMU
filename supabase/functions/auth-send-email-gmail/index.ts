import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type EmailActionType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email"
  | "reauthentication"
  | string;

type HookPayload = {
  user: { email?: string; new_email?: string };
  email_data: {
    token_hash: string;
    token_hash_new?: string;
    redirect_to: string;
    email_action_type: EmailActionType;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const FROM_EMAIL = Deno.env.get("GOOGLE_GMAIL_FROM_EMAIL") || "edusurgcmu@gmail.com";

function htmlEscape(value: unknown) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character
  ));
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeSubject(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

async function gmailAccessToken() {
  const clientId = Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GOOGLE_GMAIL_CLIENT_SECRET") || "";
  const refreshToken = Deno.env.get("GOOGLE_GMAIL_REFRESH_TOKEN") || "";
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Gmail OAuth is not configured");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Google OAuth token exchange failed");
  }
  return String(payload.access_token);
}

async function sendGmail(to: string, subject: string, html: string) {
  const accessToken = await gmailAccessToken();
  const raw = [
    `From: Surgery CMU Logbook <${FROM_EMAIL}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
  ].join("\r\n");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(raw) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) throw new Error(payload.error?.message || `Gmail API error ${response.status}`);
}

function emailContent(action: EmailActionType, verificationUrl: string) {
  const content: Record<string, { subject: string; heading: string; body: string; button: string }> = {
    signup: {
      subject: "ยืนยันอีเมลสำหรับ Surgery CMU Logbook",
      heading: "ยืนยันอีเมลของคุณ",
      body: "กรุณากดปุ่มด้านล่างเพื่อยืนยันอีเมลและเปิดใช้งานบัญชี",
      button: "ยืนยันอีเมล",
    },
    recovery: {
      subject: "ตั้งรหัสผ่านใหม่สำหรับ Surgery CMU Logbook",
      heading: "ตั้งรหัสผ่านใหม่",
      body: "เราได้รับคำขอเปลี่ยนรหัสผ่าน กรุณากดปุ่มด้านล่างเพื่อดำเนินการต่อ",
      button: "ตั้งรหัสผ่านใหม่",
    },
    invite: {
      subject: "คำเชิญเข้าใช้งาน Surgery CMU Logbook",
      heading: "เปิดใช้งานบัญชีของคุณ",
      body: "กรุณากดปุ่มด้านล่างเพื่อยืนยันอีเมลและเข้าใช้งานระบบ",
      button: "เปิดใช้งานบัญชี",
    },
    magiclink: {
      subject: "ลิงก์เข้าสู่ระบบ Surgery CMU Logbook",
      heading: "เข้าสู่ระบบ",
      body: "กรุณากดปุ่มด้านล่างเพื่อเข้าสู่ระบบอย่างปลอดภัย",
      button: "เข้าสู่ระบบ",
    },
    email_change: {
      subject: "ยืนยันการเปลี่ยนอีเมล Surgery CMU Logbook",
      heading: "ยืนยันอีเมลใหม่",
      body: "กรุณากดปุ่มด้านล่างเพื่อยืนยันการเปลี่ยนแปลงอีเมล",
      button: "ยืนยันอีเมลใหม่",
    },
    reauthentication: {
      subject: "ยืนยันตัวตน Surgery CMU Logbook",
      heading: "ยืนยันตัวตน",
      body: "กรุณากดปุ่มด้านล่างเพื่อยืนยันตัวตนและดำเนินการต่อ",
      button: "ยืนยันตัวตน",
    },
  };
  const selected = content[action] || content.magiclink;
  const safeUrl = htmlEscape(verificationUrl);
  return {
    subject: selected.subject,
    html: `<!doctype html><html lang="th"><body style="margin:0;background:#f5f7f5;font-family:Arial,sans-serif;color:#202124">
      <div style="max-width:560px;margin:32px auto;background:#fff;border:1px solid #dfe5df;border-radius:12px;padding:32px">
        <h1 style="margin:0 0 20px;color:#155426;font-size:25px">${selected.heading}</h1>
        <p style="font-size:16px;line-height:1.7">${selected.body}</p>
        <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#155426;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">${selected.button}</a></p>
        <p style="font-size:13px;line-height:1.6;color:#667085">หากปุ่มไม่ทำงาน ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br><a href="${safeUrl}" style="color:#155426;word-break:break-all">${safeUrl}</a></p>
        <p style="margin-top:28px;font-size:12px;color:#7a817d">หากคุณไม่ได้เป็นผู้ดำเนินการ สามารถละเว้นอีเมลฉบับนี้ได้</p>
      </div>
    </body></html>`,
  };
}

function errorResponse(message: string, status = 500) {
  return Response.json({ error: { http_code: status, message } }, { status });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  const configuredSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "";
  if (!configuredSecret) return errorResponse("Send Email Hook is not configured", 503);

  const rawPayload = await request.text();
  let payload: HookPayload;
  try {
    const secret = configuredSecret.replace(/^v1,whsec_/, "");
    payload = new Webhook(secret).verify(rawPayload, Object.fromEntries(request.headers)) as HookPayload;
  } catch {
    return errorResponse("Invalid webhook signature", 401);
  }

  const { user, email_data: emailData } = payload;
  const recipient = emailData.email_action_type === "email_change" && user.new_email
    ? user.new_email
    : user.email;
  if (!recipient || !emailData.token_hash || !SUPABASE_URL) return errorResponse("Incomplete email hook payload", 400);

  const verificationUrl = new URL(`${SUPABASE_URL}/auth/v1/verify`);
  verificationUrl.searchParams.set("token", emailData.token_hash);
  verificationUrl.searchParams.set("type", emailData.email_action_type);
  verificationUrl.searchParams.set("redirect_to", emailData.redirect_to);
  const message = emailContent(emailData.email_action_type, verificationUrl.toString());

  try {
    await sendGmail(recipient, message.subject, message.html);
    return Response.json({});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send authentication email";
    console.error("Auth email delivery failed", message);
    return errorResponse(message, 502);
  }
});
