# LINE e-Sign

ระบบเซ็นเอกสารออนไลน์ผ่าน LINE ตาม PRD (Nov 15, 2026) สร้างตาม stack ที่ PRD กำหนด:
**NestJS + PostgreSQL 16 + React/Vite** บน Windows Server เครื่องเดียว ไม่ใช้ Docker และ Redis

> สถานะ: **เฟส 1 (ราฐาน) เสร็จแล้ว** — LINE Login, ลงทะเบียน, ลายเซ็น + ไดคัท, หลังบ้านบริษัทและพนักงาน, แจ้งผลอนุมัติทาง LINE
> เฟส 2 (เอกสารและการเซ็น) และเฟส 3 (ค้นหา + OCR) ยังไม่ได้ทำ

```
line-esign/
  backend/    NestJS API  (Kysely + pg, คิวงานใน PostgreSQL)
  frontend/   React + Vite + TypeScript (mobile-first)
  deploy/     Caddyfile, สคริปต์ติดตั้ง Windows service (NSSM), สคริปต์สำรองข้อมูล
```

## สิ่งที่ทำแล้วในเฟส 1

| รหัส | ทำแล้ว | หมายเหตุ |
|---|---|---|
| AUTH-01 | ✅ | LINE Login v2.1 + OpenID Connect ตรวจ `state` และ `nonce` ทุกครั้ง และเพิ่ม PKCE |
| AUTH-02 | ✅ | `bot_prompt=aggressive` เก็บสถานะเพื่อนกับ OA จาก friendship API และ webhook follow/unfollow |
| AUTH-03 | ✅ | JWT ใน httpOnly cookie (SameSite=Lax) อายุ 7 วัน ต่ออายุเองเมื่อใช้งาน |
| REG-01..08 | ✅ | ฟอร์มลงทะเบียน 3 ขั้น (ข้อมูล → ลายเซ็น → ยินยอม PDPA) เก็บเวอร์ชันและ SHA-256 ของข้อความยินยอม |
| SIG-01..06 | ✅ | วาดด้วย signature_pad (เส้นบางตามความเร็ว), อัปโหลด/ถ่ายรูปพร้อมไดคัท, ปรับความไว สีหมึก หมุน ครอป, ประมวลผลในเบราว์เซอร์ทั้งหมด |
| SIG-07 | ⏳ เฟส 2 | คัดลอกลายเซ็นไปกับเอกสารตอนเซ็น |
| ADM-01..09 | ✅ | บริษัท, ลิงก์เชิญ + รหัส 8 หลัก + QR, ผู้ดูแลหลายคน (ต้องเหลืออย่างน้อย 1), อนุมัติ/ปฏิเสธ/ระงับ, แผนก/ตำแหน่ง, สิทธิ์สร้างเอกสาร, นำเข้า Excel/CSV, dashboard, log ผู้ดูแล |
| ADM-10, 11 | ⏳ เฟส 2 | คลังตราประทับ, ใบรับรองดิจิทัล .p12 |
| แจ้งเตือน LINE | ✅ บางส่วน | ผลอนุมัติ/ปฏิเสธสมาชิก, คิวใน PostgreSQL (`FOR UPDATE SKIP LOCKED`) ส่งซ้ำสูงสุด 3 ครั้งพร้อม `X-Line-Retry-Key`, บันทึกทุกข้อความ, ช่วงห้ามส่ง 21:00–08:00, นับยอดต่อเดือน |
| NFR | ✅ | ตรวจ Origin ทุก request ที่เปลี่ยนข้อมูล, rate limit, ไฟล์เข้ารหัส AES-256-GCM, audit log แก้/ลบไม่ได้ (trigger), health check, เวลาเก็บเป็น UTC แสดงเป็นเวลาไทย พ.ศ. |

### สิ่งที่ผมตีความเอง (ควรยืนยันกับเจ้าของ PRD)

1. **ช่วงห้ามส่ง 21:00–08:00** ใช้กับข้อความอัตโนมัติ (เตือนใกล้ครบกำหนด เลยกำหนด ใบรับรองใกล้หมดอายุ) ส่วนข้อความที่ตอบสนองการกระทำของคน เช่นผลอนุมัติสมาชิก ส่งทันที เพราะ REG-06 กำหนด "ภายใน 1 นาที"
2. **แต่งตั้ง/ถอด Company Admin ได้เฉพาะ Super Admin** (ADM-03) Company Admin อนุมัติ ระงับ และแก้ข้อมูลพนักงานได้ แต่เปลี่ยนบทบาทไม่ได้
3. **นำเข้ารายชื่อ (ADM-07)**: แผนกหรือตำแหน่งในไฟล์ที่ยังไม่มีจะถูกสร้างให้เอง และคำขอที่รออยู่แล้วซึ่งรหัส + เบอร์ตรงกัน จะได้รับอนุมัติทันทีหลังนำเข้า
4. **แผนก/ตำแหน่งบังคับเลือก** เมื่อบริษัทมีรายการนั้นอย่างน้อย 1 รายการ ถ้ายังไม่มีเลยจะไม่ถาม
5. ข้อความยินยอม PDPA ใน `backend/src/users/consent.ts` เป็น **ร่าง** ให้ฝ่ายกฎหมาย/DPO ตรวจก่อนใช้จริง แก้ข้อความแล้วต้องเปลี่ยน `PDPA_CONSENT_VERSION` ทุกคนจะถูกถามใหม่

## รันบนเครื่องพัฒนา

ต้องมี Node.js 22 และ PostgreSQL 16

```bash
# 1) ฐานข้อมูล
psql -U postgres -c "CREATE USER esign WITH PASSWORD 'esign_dev';" -c "CREATE DATABASE esign OWNER esign;"
#    (สร้าง extension pgcrypto, pg_trgm ได้ต้องใช้สิทธิ์ superuser หรือสร้างไว้ก่อนด้วย postgres)

# 2) API
cd backend
cp .env.example .env          # ใส่ FILE_ENCRYPTION_KEY: openssl rand -base64 32
npm install
npm run dev                   # migrate ฐานข้อมูลเองตอนเริ่ม แล้วเปิดที่ 127.0.0.1:3100

# 3) เว็บ
cd ../frontend
npm install
npm run dev                   # http://localhost:5173  (proxy /api ไปที่ API)
```

ถ้ายังไม่มี LINE channel ให้ใช้ **เข้าสู่ระบบแบบทดสอบ** ในหน้า login (`DEV_LOGIN_ENABLED=true`) พิมพ์ LINE userId รูปแบบ `U` + เลขฐานสิบหก 32 ตัว
ถ้าใส่ userId ที่อยู่ใน `SUPER_ADMIN_LINE_USER_IDS` จะได้สิทธิ์ Super Admin ข้อความ LINE จะถูกเขียนลง log ของ server แทนการส่งจริง จนกว่าจะตั้ง `LINE_PUSH_ENABLED=true`

### ทดสอบ

```bash
cd backend && npm test        # unit + e2e 21 เคส กับ PostgreSQL จริง (สร้างฐาน esign_test ใหม่ทุกครั้ง)
cd frontend && npm test       # อัลกอริทึมไดคัทลายเซ็น 8 เคส
```

## ตั้งค่า LINE

1. ใน LINE Developers Console สร้าง **LINE Login channel** และ **Messaging API channel** ภายใต้ **Provider เดียวกัน** (userId แยกตาม Provider)
2. LINE Login channel
   - Callback URL: `https://<โดเมน>/api/auth/line/callback`
   - เปิด OpenID Connect และผูก LINE OA (Linked OA) เพื่อให้ `bot_prompt` ทำงาน
   - ใส่ Channel ID / Secret ใน `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET`
3. Messaging API channel
   - Webhook URL: `https://<โดเมน>/api/line/webhook` (เปิด Use webhook)
   - ใส่ Channel secret ใน `LINE_MESSAGING_CHANNEL_SECRET`, long-lived channel access token ใน `LINE_MESSAGING_ACCESS_TOKEN`, Basic ID ใน `LINE_OA_BASIC_ID`
4. Super Admin คนแรก: login ด้วย LINE หนึ่งครั้ง ดู userId ในตาราง `users` แล้วใส่ใน `SUPER_ADMIN_LINE_USER_IDS` และ restart service

## ติดตั้งบน Windows Server

1. ติดตั้ง Node.js 22 LTS, PostgreSQL 16, [Caddy](https://caddyserver.com) และ [NSSM](https://nssm.cc)
2. วางโค้ดที่ `C:\esign` แล้ว `npm ci && npm run build` ทั้งใน `backend` และ `frontend`
3. สร้าง `backend\.env` จาก `.env.example` ตั้ง `NODE_ENV=production`, `DEV_LOGIN_ENABLED=false`, `APP_ORIGIN` และ `API_BASE_URL` เป็นโดเมนจริง
   - **สำรอง `FILE_ENCRYPTION_KEY` แยกไว้ที่ปลอดภัย** ถ้าหายจะเปิดลายเซ็นที่เก็บไว้ไม่ได้
4. `deploy\install-service.ps1` ติดตั้ง API เป็น Windows service ที่เริ่มใหม่เองเมื่อล่ม
5. แก้โดเมนใน `deploy\Caddyfile` แล้วติดตั้ง Caddy เป็น service (`nssm install caddy caddy.exe run --config C:\esign\deploy\Caddyfile`)
6. ตั้ง Task Scheduler ให้รัน `deploy\backup.ps1` ทุกคืน (pg_dump + สำเนาไฟล์ไป NAS เก็บ 30 วัน) และทดสอบกู้คืนทุกไตรมาส
7. ตั้งระบบ monitor ให้เรียก `https://<โดเมน>/api/health` และแจ้งผู้ดูแลเมื่อไม่ตอบ

## API (เฟส 1)

ทุก path ขึ้นต้นด้วย `/api`

| Method + Path | ใช้ทำอะไร |
|---|---|
| `GET /auth/config` · `GET /auth/line/login` · `GET /auth/line/callback` · `POST /auth/logout` | LINE Login |
| `GET /me` · `POST /me/register` · `PUT /me/profile` · `POST /me/consent` · `GET /consent` | ข้อมูลตัวเองและการยินยอม |
| `GET/POST /me/signatures` · `GET /me/signatures/:id/image` | ลายเซ็นและประวัติ |
| `GET /companies/lookup?code=\|token=` · `POST /companies/join` | ขอเข้าร่วมบริษัท |
| `GET /companies/:id/dashboard` · `GET /companies/:id/members` · `PATCH /memberships/:id` | Company Admin: พนักงาน |
| `GET/POST /companies/:id/departments\|positions` · `PATCH .../:itemId` | แผนกและตำแหน่ง |
| `GET /companies/:id/invite` · `POST /companies/:id/invite/rotate` | ลิงก์เชิญและรหัส |
| `GET/POST /companies/:id/employee-imports` | นำเข้ารายชื่อ |
| `GET /companies/:id/audit` | log ผู้ดูแลของบริษัท |
| `GET /admin/overview` · `GET/POST /admin/companies` · `PATCH /admin/companies/:id` | Super Admin: บริษัท |
| `POST /admin/companies/:id/admins` · `DELETE /admin/companies/:id/admins/:userId` · `GET /admin/users` | แต่งตั้ง/ถอด Company Admin |
| `GET /admin/audit` · `GET /health` · `POST /line/webhook` | log ระบบ, health check, webhook |

## ต่อไป: เฟส 2 (เอกสาร + การเซ็น)

ตาราง `documents`, `document_pages`, `fields`, `document_signers`, `document_events`, `company_stamps`, `company_certificates`
แล้วต่อยอดจากของที่มีอยู่: คิวงาน (`JobsService`), การแจ้งเตือน (`NotificationsService` + `templates.ts`), ที่เก็บไฟล์เข้ารหัส (`StorageService`), audit log

จุดที่ต้องระวังเป็นพิเศษ: วางข้อความไทยใน PDF ให้สระและวรรณยุกต์ถูกตำแหน่ง (ต้องใช้ text shaping เช่น harfbuzzjs หรือ fontkit layout ไม่ใช่ `drawText` ตรง ๆ ของ pdf-lib) และซีล PAdES ด้วย `@signpdf` + TSA
