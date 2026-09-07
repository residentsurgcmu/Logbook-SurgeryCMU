# Resident Surgery EPA/PBA Assessment

ระบบประเมิน Resident ของภาควิชาศัลยศาสตร์ มหาวิทยาลัยเชียงใหม่ ใช้ EPA และ PBA จากโฟลเดอร์ `EPA/` และ `PBA/` เท่านั้น ไม่มีการแสดงหรือย้ายข้อมูล Student logbook เดิมในส่วนติดต่อผู้ใช้ใหม่

## สิ่งที่ระบบรองรับ

- Resident ดูประวัติการประเมินของตนเอง
- Evaluator ประเมินได้เฉพาะ Resident ที่ Admin มอบหมาย
- Admin ซิงก์ catalog, เชิญบัญชี, มอบหมาย Evaluator และดูรายงาน
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
```

ให้ apply migration นี้ใน project ref `dyiiivcyoatgmkmvgcnt` แล้ว deploy Edge Function `resident-admin` พร้อมตั้ง `SUPABASE_URL`, `SUPABASE_ANON_KEY` และ `SUPABASE_SERVICE_ROLE_KEY` เป็น secret ของ Supabase Edge Function เท่านั้น

หลัง migration ผู้ใช้ `resident.surgcmu@gmail.com` จะเป็น Admin ก็ต่อเมื่อมี Auth user เดิมอยู่แล้ว หากยังไม่มี ให้สร้างบัญชี Auth นั้นก่อน แล้วรันส่วน bootstrap ของ migration อีกครั้งโดยผู้ดูแลระบบ

ใน Supabase Auth ให้เปิด Email provider, ตั้ง Site URL/Redirect URL เป็น Vercel URL ใหม่ และตั้ง SMTP operational identity เป็น `resident.surgcmu@gmail.com` โดยเก็บ Gmail App Password ใน Supabase SMTP settings เท่านั้น

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

ทดสอบบน Chrome ที่ desktop และ mobile: login ของ Resident, ประวัติของตนเอง, การจำกัด Evaluator ตาม assignment, การบันทึก assessment ที่คะแนนครบทุกข้อ, และ Admin provision/assignment/sync catalog. ทดสอบ RLS โดยใช้ผู้ใช้ต่าง role อย่างน้อยสองบัญชี และยืนยันว่าไม่สามารถอ่านหรือเขียน assessment ของ Resident ที่ไม่ได้รับสิทธิ์

## Privacy

กรอกเฉพาะบริบททางคลินิกแบบไม่ระบุตัวตน ห้ามบันทึกชื่อผู้ป่วย, HN, เลขบัตรประชาชน หรือข้อมูลที่ระบุตัวบุคคลได้โดยตรง
