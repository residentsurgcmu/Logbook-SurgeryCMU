# Design: New admissions + ประชุมวันศุกร์ (เฟส 1)

วันที่: 2026-10-02 · สถานะ: รอเจ้าของระบบ (Chagkrit) ตรวจ spec ก่อนทำแผนลงมือ

## 1. เป้าหมาย

เพิ่มพื้นที่ทำงานให้ Resident/Staff/Admin บันทึกเคส admit ใหม่ แนบภาพ และใช้เคสเหล่านั้นนำเสนอในประชุมวันศุกร์ พร้อมจดข้ออภิปราย ทำบน Supabase project เดิม (`dyiiivcyoatgmkmvgcnt`) ใช้ Auth/role เดิม

แรงบันดาลใจด้านหน้าจอมาจาก prototype `resident-corner-sense` (vanilla JS ไม่มี backend) นำมาเฉพาะแนวคิดและ layout เขียนใหม่เป็น React ตามแบบแผนของเว็บนี้ ไม่ copy โค้ด

### สำเร็จเมื่อ
- ผู้ใช้ที่ active ทั้ง 3 role เพิ่ม/ค้นหา/กรองเคสได้ และสิทธิ์แก้ไข/ลบเป็นไปตามข้อ 4
- แนบภาพ (jpeg/png/webp ≤ 5 MB) ได้ และภาพที่เก็บไม่มี EXIF/GPS
- โหมดนำเสนอแสดงเคสของสัปดาห์ที่เลือกทีละเคส และจดโน้ตได้หลายคนโดยไม่ทับกัน
- ไม่มีข้อมูลระบุตัวผู้ป่วยโดยตรง (ชื่อ, HN) ในโครงสร้างข้อมูล
- `npm test` และ `npm run build` ผ่าน, ตาราง/ข้อมูลเดิมไม่ถูกแก้

## 2. ขอบเขต

**ทำ:** รับเคส, แก้ไข/เปลี่ยนสถานะ, แนบภาพ, โหมดนำเสนอ + โน้ตอภิปราย

**ไม่ทำ (เฟสถัดไปหรือไม่ทำ):** ตารางเวร/OR, คลังวิดีโอ, OAuth Microsoft/Google, หน้าจัดการสมาชิกใหม่ (ใช้หน้า "จัดการระบบ" เดิม), role Moderator, อัปโหลดวิดีโอ, ระบบ audit/ประวัติการแก้ไข, ลบข้อมูลอัตโนมัติตามอายุ

## 3. การตัดสินใจที่เจ้าของระบบอนุมัติแล้ว

| หัวข้อ | ข้อสรุป |
|---|---|
| การมองเห็น | ทั้งภาควิชา (Resident/Staff/Admin ที่ active) เห็นทุกเคส ไม่จำกัดตามหน่วย |
| อายุ | เก็บอายุจริง (ปี) |
| Staff แก้ไข | Staff แก้ได้ทุกเคส |
| การเก็บรักษา | ไม่ลบอัตโนมัติ Admin ลบถาวรเอง |

หมายเหตุ: การเปิดให้ทั้งภาควิชาเห็นเคสกว้างกว่าสิทธิ์อ่านของระบบประเมินเดิมโดยตั้งใจ เพราะธรรมชาติของประชุมวันศุกร์ ส่วนแนวปฏิบัติ PDPA/retention ของคณะเป็นหน้าที่เจ้าของระบบยืนยันนอกระบบนี้

## 4. สิทธิ์

| การกระทำ | Resident | Staff | Admin |
|---|---|---|---|
| อ่านเคส/ภาพ/โน้ต | ทุกเคส | ทุกเคส | ทุกเคส |
| เพิ่มเคส | ได้ | ได้ | ได้ |
| แก้เคส | เฉพาะที่ตนสร้างหรือเป็น owner | ทุกเคส | ทุกเคส |
| ลบเคส (soft) | เฉพาะที่ตนสร้าง | ไม่ได้ | ทุกเคส |
| ลบเคสถาวร | ไม่ได้ | ไม่ได้ | ได้ (RPC) |
| เพิ่มภาพ | ผู้ที่แก้เคสนั้นได้ | เหมือนกัน | เหมือนกัน |
| ลบภาพ (soft) | เฉพาะที่ตนอัปโหลด | เฉพาะที่ตนอัปโหลด | ทุกภาพ |
| เพิ่มโน้ต | ได้ | ได้ | ได้ |
| แก้/ลบโน้ต (soft) | เฉพาะของตน | เฉพาะของตน | ลบได้ทุกโน้ต, แก้ได้เฉพาะของตน |

- ผู้ใช้ที่ไม่มี role active ใน `resident_user_roles` ถูกปฏิเสธทุกการกระทำ (ผ่าน `private.resident_role_is()` เดิม)
- รายการที่ soft-deleted (`deleted_at is not null`) ซ่อนจาก SELECT ของทุก role ยกเว้น Admin
- ข้อ "ภาพ" และ "โน้ตของ Admin" เป็นรายละเอียดที่ spec นี้กำหนดเพิ่มจากที่คุยกัน ตรวจและแก้ได้ตอน review

## 5. โครงสร้างข้อมูล

migration ไฟล์เดียว additive ชื่อ `supabase/migrations/<timestamp>_resident_admission_cases.sql` ไม่แก้/ไม่ลบตารางเดิม ทุกตารางเปิด RLS

### `resident_admission_cases`
| คอลัมน์ | ชนิด | เงื่อนไข |
|---|---|---|
| id | uuid pk | default gen_random_uuid() |
| case_code | text unique | `'ADM-' \|\| lpad(nextval('resident_admission_case_seq')::text, 5, '0')` ตั้งโดย DB |
| admit_date | date | ไม่เกินวันนี้ตามเวลา Asia/Bangkok (ใช้แบบเดียวกับ `20260928090000_bangkok_assessment_date_and_cme_ahead.sql`) |
| age_years | smallint | 0–120 |
| sex | text | `male` / `female` / `unspecified` |
| diagnosis | text | not null, 1–180 ตัวอักษรหลัง trim |
| management | text | default '', ≤ 1000 |
| operation | text | default '', ≤ 180 |
| unit_name | text | `Upper GI` / `General surgery` / `HBP` (check constraint; เพิ่มหน่วยด้วย migration เล็ก) |
| status | text | `admit` / `discharged` / `pending_update` |
| owner_id | uuid | → `resident_profiles(user_id)` |
| created_by, updated_by | uuid | → auth.users, ตั้งโดย trigger |
| created_at, updated_at | timestamptz | ตั้งโดย trigger (server time) |
| deleted_at | timestamptz null | soft delete |

Index: `(admit_date desc)`, `(status)`, `(owner_id)` และ index ของ foreign key ทุกตัว (ตามที่เว็บเดิมทำใน migration `*_foreign_key_indexes`)

### `resident_case_media`
`id`, `case_id` → cases, `storage_path` (unique), `caption` (≤ 200), `created_by`, `created_at`, `deleted_at`

### `resident_case_notes` (append-only หลายผู้เขียน)
`id`, `case_id` → cases, `author_id` → auth.users, `body` (1–2000), `created_at`, `edited_at null`, `deleted_at null`

### Storage
Bucket `resident-case-media`: private, `file_size_limit` 5242880, mime `image/jpeg|png|webp`, path `{case_id}/{uuid}.{ext}` Policy ของ storage.objects ผูกกับสิทธิ์เหนือเคสนั้น (อ่าน = ผู้ใช้ active ใดๆ, เขียน = ผู้แก้เคสได้) ตามรูปแบบ policy ของ bucket `resident-round-cme-qr` ภาพอ่านผ่าน signed URL อายุสั้น

## 6. การเขียนข้อมูลและกัน race

- **ทุกการเขียนผ่าน RPC แบบ SECURITY DEFINER** (สร้าง/แก้/soft delete เคส, เพิ่ม/ลบภาพ, เพิ่ม/แก้/ลบโน้ต) โดย `authenticated` มีสิทธิ์ SELECT อย่างเดียวบนตารางใหม่ (กรองด้วย RLS) ไม่มี policy หรือ grant สำหรับ INSERT/UPDATE/DELETE ตรง ฟังก์ชันตรวจ role ตามข้อ 4 และประทับ `created_by`, `updated_by`, `updated_at`, `case_code` ฝั่ง server เอง (client ส่งมาไม่ได้)
- RPC `update_resident_admission_case(p_case_id, p_expected_updated_at, ...)` ใช้สำหรับแก้ไข/เปลี่ยนสถานะ: ถ้า `updated_at` ไม่ตรงกับที่ client เห็น คืน error ให้ UI โหลดใหม่ (กันเขียนทับกัน)
- RPC `admin_purge_resident_admission_case(p_case_id)` ลบถาวรเคส + แถวภาพ/โน้ต และคืน storage_path ที่ต้องลบ (frontend ลบ object แล้ว) เฉพาะ Admin
- soft delete เคส = RPC `soft_delete_resident_admission_case` ตามสิทธิ์ข้อ 4 (ตรวจ `updated_at` เหมือนการแก้)

## 7. ความเป็นส่วนตัว

- ไม่มีคอลัมน์ชื่อ/HN; ฟอร์มและหน้าอัปโหลดมีข้อความเตือนว่าห้ามใส่ข้อมูลระบุตัวใน free-text และในภาพ
- ภาพถูกอ่านและ encode ใหม่ผ่าน canvas ฝั่ง client ก่อนอัปโหลด เพื่อลบ EXIF/GPS และจำกัดขนาด (ขอบยาวสูงสุด 2000 px, quality ~0.85) เป็นมาตรการลดความเสี่ยง ไม่ใช่การรับประกันว่าภาพไม่มีใบหน้า/ป้ายชื่อ
- bucket private ไม่มี public URL
- ผู้ใช้ที่ถูก deactivate เข้าถึงข้อมูลไม่ได้ทันที (RLS ตรวจ `active` ทุกครั้ง)

## 8. หน้าจอ (React)

ไฟล์ใหม่ ไม่เพิ่ม dependency:
- `src/residentCasesApi.js` data layer ของฟีเจอร์นี้ (ไม่เพิ่มใน `residentApi.js`)
- `src/features/ResidentCases.jsx` ตารางเคส, ค้นหา (diagnosis/case_code), กรองสถานะ/หน่วย, ฟอร์มเพิ่ม/แก้, dialog รายละเอียด + ภาพ
- `src/features/ResidentConference.jsx` เลือกสัปดาห์ (จันทร์–ศุกร์ ค่าเริ่มต้นสัปดาห์ปัจจุบันตามเวลาไทย), ตัวเลือกเคส + ก่อนหน้า/ถัดไป, ภาพ, รายการโน้ตหลายคนพร้อมช่องเพิ่มโน้ต

แก้ `src/features/ResidentPlatform.jsx` เฉพาะ: เพิ่มเมนู `cases` ("New admissions") และ `conference` ("ประชุมวันศุกร์") ใน array `nav` ของทั้ง 3 role และ map ไป component ใหม่ ใช้ `Icons.jsx` และ `resident.css` เดิม

## 9. การทดสอบ

ตามแบบของ repo:
- `tests/resident-cases.test.mjs` (node --test): logic ฝั่ง client (ตรวจ input, ชื่อไฟล์/path, ช่วงสัปดาห์ จันทร์–ศุกร์ เวลาไทย) และ regex ตรวจ migration ว่ามี RLS/check/trigger ครบ
- `tests/resident-cases-db.sql`: สคริปต์ตรวจ RLS ต่อ role (รันโดยเจ้าของระบบกับ DB จริง อ่านผลด้วย select)
- `npm test` และ `npm run build` ต้องผ่านก่อน merge
- ตรวจมือหลัง deploy: เพิ่มเคส, แนบภาพ, แก้ซ้อนกันสองหน้าต่างเพื่อดู error `updated_at`, โหมดนำเสนอ, สลับ role ทั้ง 3 แบบ

## 10. การ deploy และ rollback

ตาม `CLAUDE.md`:
1. ผมเขียน migration + โค้ด + test บน branch แยก
2. **ห้าม `supabase db push`** เจ้าของระบบรัน `! supabase db query --linked -f supabase/migrations/<file>.sql` เอง (การเขียน production ถูกบล็อกสำหรับ Claude) ผมตรวจก่อน/หลังด้วย select แบบ read-only
3. หลังตรวจ migration แล้วจึง merge/push เพื่อให้ Vercel deploy frontend (migration ก่อน frontend เสมอ)

Rollback: `drop` เฉพาะตาราง/sequence/function/bucket ใหม่ของฟีเจอร์นี้ ข้อมูลประเมิน/สอบ/เช็กชื่อเดิมไม่เกี่ยวข้อง

## 11. ความเสี่ยงที่รู้และยังเปิดอยู่

- นโยบาย PDPA/ระยะเก็บข้อมูลของคณะยังไม่ได้ยืนยัน (นอกขอบเขตระบบ) ถ้าคณะกำหนด retention ภายหลังต้องเพิ่มงานลบอัตโนมัติ
- ไม่มีบันทึกประวัติการแก้ไข (audit) เคสที่ถูกแก้/ลบดูย้อนหลังไม่ได้นอกจาก `updated_by`/`deleted_at`
- ภาพอาจมีข้อมูลระบุตัวในเนื้อภาพ ระบบลบได้เฉพาะ metadata
