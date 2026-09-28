# Resident Surgery EPA/PBA Assessment

ระบบประเมิน Resident ของภาควิชาศัลยศาสตร์ มหาวิทยาลัยเชียงใหม่ ใช้ EPA และ PBA จากโฟลเดอร์ `EPA/` และ `PBA/` เท่านั้น ไม่มีการแสดงหรือย้ายข้อมูล Student logbook เดิมในส่วนติดต่อผู้ใช้ใหม่

## สิ่งที่ระบบรองรับ

- Resident ดูประวัติการประเมินของตนเอง
- Staff ประเมินได้เฉพาะ Resident ที่ Admin มอบหมาย
- Admin ซิงก์ catalog, ส่งคำเชิญ Staff จากรายชื่ออาจารย์ที่อนุมัติ, มอบหมาย Staff และดูรายงาน
- หน้า login แยก Resident, Staff และ Admin พร้อมลิงก์ลืมรหัสผ่านสำหรับทุกบทบาท
- EPA 1–6, EPA 7 Basic Laparoscopic และ EPA 8 (OPD)
- PBA แบบละเอียด 21 แบบ พร้อมลำดับเกณฑ์และมาตราส่วนตามเอกสารต้นทาง
- EPA 1–6/8 ใช้ L1–L5; EPA 7 และ PBA ใช้ F/M/E
- การบันทึกคะแนนต้องครบทุกเกณฑ์และตรวจสอบสิทธิ์/มาตราส่วนใน PostgreSQL ก่อนลงนาม

## Source catalog

สร้าง catalog ที่ commit ไว้ด้วยคำสั่งนี้เมื่อเอกสารต้นทางมีการแก้ไข:

```bash
pnpm generate:templates
```

ตัวสร้างอ่านเฉพาะ `EPA/` และ `PBA/` และบันทึก source hash, criterion order และ score options ใน `src/generated/residentTemplates.js` เพื่อให้ตรวจสอบความเปลี่ยนแปลงของต้นทางได้

## Local run

```bash
pnpm install
cp .env.example .env.local
pnpm test
pnpm build
pnpm dev
```

ตั้งค่า `.env.local` ด้วย publishable key ของ Supabase project `dyiiivcyoatgmkmvgcnt` เท่านั้น:

```env
VITE_SUPABASE_URL=https://dyiiivcyoatgmkmvgcnt.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_APP_URL=https://resident-surgery-logbook.vercel.app
```

ห้ามใส่ `service_role` key, Gmail App Password หรือ OAuth secret ในตัวแปร `VITE_` หรือ source code ฝั่ง browser

## Supabase deployment

migration เป็น additive และไม่ลบ Auth users หรือ legacy Student tables/data:

```text
supabase/migrations/202609070001_resident_assessment_platform.sql
supabase/migrations/20260908090000_add_resident_staff_directory_and_password_reset.sql
```

ให้ apply migrations ตามลำดับใน project ref `dyiiivcyoatgmkmvgcnt` แล้ว deploy Edge Function `resident-admin` พร้อมตั้ง `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` และ `APP_URL=https://resident-surgery-logbook.vercel.app` เป็น secret ของ Supabase Edge Function เท่านั้น

Migration ใหม่เปลี่ยนชื่อ role `evaluator` เดิมเป็น `staff` โดยคงข้อมูลบัญชีและ assignment เดิมไว้ และนำเข้า 35 แถวจาก `รายชื่ออาจารย์ ปี 4.xlsx` ลงใน Staff directory แบบไม่ส่งคำเชิญอัตโนมัติ. แถวที่ระบุหน่วย `test` ถูกเก็บไว้เพื่อให้ตรวจสอบแหล่งข้อมูลได้ แต่ตั้งเป็น inactive จึงเชิญหรือใช้เป็น Staff ไม่ได้.

หลัง migration ผู้ใช้ `resident.surgcmu@gmail.com` จะเป็น Admin ก็ต่อเมื่อมี Auth user เดิมอยู่แล้ว หากยังไม่มี ให้สร้างบัญชี Auth นั้นก่อน แล้วรันส่วน bootstrap ของ migration อีกครั้งโดยผู้ดูแลระบบ

ใน Supabase Auth ให้เปิด Email provider และตั้งค่าดังนี้:

- Site URL: `https://resident-surgery-logbook.vercel.app`
- Redirect URL: `https://resident-surgery-logbook.vercel.app/reset-password`
- SMTP operational identity: `resident.surgcmu@gmail.com` โดยเก็บ Gmail App Password ใน Supabase SMTP settings เท่านั้น
- Email templates: ตั้งหัวข้อ/เนื้อหา Invite และ Reset password เป็นภาษาไทย และเปิด password-changed notification

ห้ามใส่ service role, SMTP password หรือ secret ใดใน Vercel browser environment variables หรือ source code ฝั่ง client.

## Edge Functions และ secrets

| Function | หน้าที่ | Secrets ที่ต้องตั้ง |
|---|---|---|
| `resident-admin` | Admin สร้าง/เชิญบัญชี (ถ้าอีเมลมีบัญชี Auth อยู่แล้วจะผูกบัญชีเดิมและส่งลิงก์ตั้งรหัสผ่าน), ลบการประเมิน | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` |
| `resident-assessment-notifier` | ส่งอีเมลแจ้ง Staff เมื่อมีคำขอประเมิน (`deliver_initial`) และอีเมลเตือน/ส่งซ้ำ (`deliver_due`) ผ่าน Gmail SMTP (App Password เดียวกับ Supabase Auth) | `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASS`, (`SMTP_FROM` ไม่บังคับ) — deploy ด้วย `--no-verify-jwt` |
| `auth-send-email-gmail` | Supabase Auth Send Email Hook (เชิญ, รีเซ็ตรหัสผ่าน ฯลฯ) ส่งผ่าน Gmail API | `GOOGLE_GMAIL_*` ชุดเดียวกัน, `SEND_EMAIL_HOOK_SECRET` |

- ตั้ง `GOOGLE_GMAIL_FROM_EMAIL` ให้ตรงกับบัญชี Gmail เจ้าของ refresh token เสมอ (สอง function มีค่า default ต่างกัน)
- `deliver_due` ถูกเรียกทุก 15 นาทีโดย cron job `resident-assessment-email-delivery` (migration `20260928130000`) secret ของ cron เก็บใน Supabase Vault (`resident_reminder_cron_secret`) และ function ตรวจกับ Vault เอง ไม่ต้องตั้ง secret เพิ่ม
- Supabase Edge Functions บล็อกพอร์ต 25 และ 587 ต้องใช้ SMTP พอร์ต 465
- ระบบใช้การเชิญเท่านั้น ให้ปิด "Allow new users to sign up" ใน Authentication settings
- ระบบเก่า Year 4 / Breast logbook ถูกปิดใน migration `20260928110000_retire_legacy_year4_breast.sql` (ถอนสิทธิ์ client, ข้อมูลยังอยู่)

## Vercel deployment

สร้าง project ใหม่ชื่อ `resident-surgery-logbook` ภายใต้บัญชี `resident.surgcmu@gmail.com` และตั้ง environment variables สำหรับ Production/Preview:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_URL=https://resident-surgery-logbook.vercel.app`

อย่าเชื่อม project นี้กับ deployment URL เดิมของ Student logbook และอย่าตั้งค่า Google Drive backup เก่าใน project ใหม่

## Verification

```bash
pnpm generate:templates
pnpm test
pnpm build
```

### MM & Grand Round attendance

Admin เป็นผู้กำหนดตารางประชุมเองและเปิด session ในเมนู “MM & Grand Round” เฉพาะวันที่มีประชุม โดยเปิดได้ก่อน 11:00 น. ตามเวลา Asia/Bangkok จากนั้นระบบแสดง QR บนจอประชุม Resident และ Staff ที่ลงชื่อเข้าใช้สแกน QR เพื่อบันทึกเวลาเข้า ระบบเปลี่ยน QR ทุก 1 นาที และปิดรับเวลา 11:00:00 น. โดยใช้เวลาเซิร์ฟเวอร์ สแกนซ้ำใน session เดียวกันจะแสดงเวลาครั้งแรก Admin ดูรายชื่อแยกตามวันและดาวน์โหลด CSV/Excel ได้

Backend migrations คือ `supabase/migrations/20260920102939_mm_grand_round_attendance.sql` และ `supabase/migrations/20260921033316_allow_admin_scheduled_round_any_day.sql` ตรวจโครงสร้าง/ขอบเวลาด้วย `npx supabase db query --linked --file tests/round-attendance-db.sql` หลัง apply migration

ทดสอบบน Chrome ที่ desktop และ mobile: login ของ Resident/Staff/Admin, ลืมรหัสผ่านและการตั้งรหัสผ่านจาก recovery link, ประวัติของ Resident, การจำกัด Staff ตาม assignment, การบันทึก assessment ที่คะแนนครบทุกข้อ, และ Admin provision/Staff invitation/assignment/sync catalog. ทดสอบ RLS โดยใช้ผู้ใช้ต่าง role อย่างน้อยสองบัญชี และยืนยันว่า Resident/Staff อ่าน Staff directory หรือส่งคำเชิญไม่ได้

## Privacy

กรอกเฉพาะบริบททางคลินิกแบบไม่ระบุตัวตน ห้ามบันทึกชื่อผู้ป่วย, HN, เลขบัตรประชาชน หรือข้อมูลที่ระบุตัวบุคคลได้โดยตรง
