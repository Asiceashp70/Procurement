# ZenHere

ระบบเซ็นเอกสารออนไลน์ผ่าน LINE ตาม PRD (Nov 15, 2026) สร้างตาม stack ที่ PRD กำหนด:
**NestJS + PostgreSQL 16 + React/Vite** บน Windows Server เครื่องเดียว ไม่ใช้ Docker และ Redis

> สถานะ: **เฟส 1 (ราฐาน), เฟส 2 (เอกสาร + การเซ็น) และเฟส 3 (ค้นหา + OCR) เสร็จแล้ว**
> เหลือเฟส 4 (นำร่องกับบริษัทจริง) และการทดสอบ OCR กับโมเดล OpenThai จริง

**ทดสอบระบบโดยยังไม่เชื่อม LINE: ดู [TESTING.md](TESTING.md)** (Windows ดับเบิลคลิก `start-test.bat`)

```
zenhere/
  backend/    NestJS API  (Kysely + pg, คิวงานใน PostgreSQL)
  frontend/   React + Vite + TypeScript (mobile-first)
  ocr-worker/ Python + FastAPI + ONNX Runtime (CPU) อ่านหน้าสแกน
  deploy/     Caddyfile, สคริปต์ติดตั้ง Windows service (NSSM), สคริปต์สำรองข้อมูล
```

## สิ่งที่ทำแล้วในเฟส 3

| รหัส | ทำแล้ว | หมายเหตุ |
|---|---|---|
| DOC-08 | ✅ | ตอนอัปโหลด ดึงข้อความทุกหน้าด้วย pdf.js (child process ไม่บล็อก API) พร้อมกรอบบรรทัดสำหรับไฮไลต์ |
| SRC-01..03 | ✅ | ค้นส่วนตัว (เอกสารที่ฉันสร้าง/ต้องเซ็น/เซ็นแล้ว), ทั้งบริษัท (Company Admin), ทุกบริษัท (Super Admin), ตัวกรอง สถานะ ช่วงวันที่ ผู้สร้าง ผู้เซ็น แผนก ประเภท แท็ก เลยกำหนด ใช้ร่วมกับคำค้นได้ |
| SRC-04 | ✅ | ผลค้นบอกหน้าและข้อความรอบคำที่เจอ กดแล้วเปิดหน้านั้นพร้อมไฮไลต์ (การเปิดเอกสารคนอื่นของ Admin ถูกบันทึก) |
| SRC-05 | ✅ | แปลงอักษรเพี้ยน (รหัส PUA ของฟอนต์ไทยรุ่นเก่า, ํ+า → ำ, วรรณยุกต์ก่อนสระบน, เลขไทย) ตัดช่องว่าง แล้วทำ index `pg_trgm` คำค้นผ่านขั้นตอนเดียวกัน ค้น "สัญญาจ้าง" เจอ "สัญญา จ้าง" |
| SRC-06..08 | ✅ | หน้าที่มีข้อความน้อยกว่า 20 ตัวอักษรและไฟล์รูปเข้าคิว OCR อัตโนมัติ, ผู้ใช้เห็น "กำลังอ่านเอกสาร", OCR worker แยกเป็นบริการ Python (ดู `ocr-worker/README.md`), ผลจาก OCR มีป้าย "จาก OCR" และค่าความมั่นใจ |
| SRC-09 | ✅ | ทดสอบกับข้อมูลจำลอง 100,000 หน้า: คำที่หายาก 5 ms, คำที่มีแทบทุกหน้า ≤ 402 ms, คำที่ไม่มี 2 ms (`SEARCH_BENCH=1 npx jest test/search.bench.spec.ts`) |

**แก้เพิ่มจากเฟส 2:** ไฟล์ฉบับสมบูรณ์ที่ระบบสร้าง ตอนนี้คัดลอกหรือดึงข้อความภาษาไทยออกมาได้ถูกต้อง (เดิมหน้าตาถูกแต่ข้อความที่คัดลอกเพี้ยน เพราะ pdf-lib ไม่ลง Unicode ให้ glyph ที่ถูกแทนที่ตอนจัดรูป)

## สิ่งที่ทำแล้วในเฟส 2

| รหัส | ทำแล้ว | หมายเหตุ |
|---|---|---|
| DOC-01 | ✅ | PDF/JPG/PNG ไม่เกิน 50 MB หรือ 200 หน้า รูปถูกแปลงเป็น PDF หน้า A4 ปฏิเสธ PDF ติดรหัสผ่านหรือไฟล์เสียพร้อมเหตุผล |
| DOC-02..07 | ✅ | ชื่อเรื่องเริ่มต้นจากชื่อไฟล์, แสดงหน้าด้วย pdf.js (render เฉพาะหน้าที่เห็น), ซูม, ช่อง 6 ชนิด ลาก ย่อขยาย คัดลอก ลบ (เมาส์และนิ้ว), ตำแหน่งเก็บเป็นสัดส่วน 0–1, เลือกผู้เซ็นค้นด้วยชื่อ รหัส แผนก, โหมดพร้อมกัน/เรียงลำดับ (ลำดับเดียวกันเซ็นพร้อมกันได้), บันทึกร่างอัตโนมัติ, ตรวจก่อนส่ง |
| DOC-08 | ✅ บางส่วน | คิด SHA-256 ต้นฉบับ และล็อกไฟล์/กรอบหลังส่ง ส่วน**ดึงข้อความรายหน้า**ย้ายไปเฟส 3 (คอลัมน์รอไว้แล้วใน `document_pages`) |
| DOC-09, 10 | ✅ | หน้ารายละเอียด: สถานะรายคน ใครเปิดดู/เซ็น/ยังไม่แอด OA, timeline, เตือนซ้ำ, ยกเลิก, ดาวน์โหลด, Admin เปลี่ยนตัวผู้เซ็น (ย้ายกรอบ แจ้ง LINE บันทึก log และแสดงในหน้าใบรับรอง) |
| SGN-01..06, 10 | ✅ | หน้าเซ็นบนมือถือ เลื่อนไปช่องของตัวเอง ตัวนับ "เหลือ N จุด", ใช้ลายเซ็นที่บันทึกหรือเซ็นสดเฉพาะครั้งนี้, วันที่เติมเอง, ติ๊กยินยอมแล้วยืนยัน, ปฏิเสธพร้อมเหตุผล, server ตรวจสิทธิ์และลำดับทุกครั้ง (403 + บันทึก), `document_events` แก้/ลบไม่ได้ |
| SGN-07, 09 | ✅ | ประทับทุกช่องลง PDF ตามตำแหน่ง (รองรับหน้าที่หมุน 90/180/270 และ CropBox), แนบหน้าใบรับรอง (ชื่อ ตำแหน่ง เวลา IP LINE userId SHA-256 ต้นฉบับ), ส่งลิงก์ให้ทุกคน (ต้อง login) |
| SGN-08 | ✅ | หน้า `/verify` อัปโหลดไฟล์แล้วเทียบ SHA-256 แก้ 1 byte ขึ้น "ไม่ตรงกับต้นฉบับ" |
| SGN-11 | ✅ | ซีล **PAdES baseline-B** (`ETSI.CAdES.detached` + signing-certificate-v2) ด้วยใบรับรอง .p12 ของบริษัท, ใส่เวลาจาก TSA (RFC 3161) ถ้าตั้ง `TSA_URL`, ไม่มีใบรับรองหรือหมดอายุ → ปิดเอกสารได้แต่ไม่ซีล และแจ้ง Admin |
| SIG-07 | ✅ | ตอนเซ็น คัดลอกรูปลายเซ็นไปเก็บกับเอกสาร แก้ลายเซ็นหลักภายหลังไม่กระทบ |
| ADM-08 | ✅ | dashboard เพิ่มเอกสารตามสถานะ เลยกำหนด ผู้ค้างเซ็นมากที่สุด และสถานะใบรับรอง |
| ADM-10, 11 | ✅ | คลังตราประทับ (ไดคัทแบบเดียวกับลายเซ็น, กำหนดคนใช้ได้, ใช้ตราทุกครั้งลง audit log), ใบรับรอง .p12 เข้ารหัสเก็บ ดาวน์โหลดคืนไม่ได้ แจ้งก่อนหมดอายุ 30 และ 7 วัน |
| แจ้งเตือน LINE | ✅ | ส่งเอกสาร, ถึงลำดับ, ใกล้ครบกำหนด (ตั้งได้ต่อบริษัท), เลยกำหนด (ทุก 24 ชม. สูงสุด 3 ครั้ง), เตือนซ้ำด้วยมือ (1 ครั้ง/ชม./คน), มีคนเซ็น (ปิดได้), ปฏิเสธ, เซ็นครบ, ยกเลิก, เปลี่ยนผู้เซ็น, ใบรับรองใกล้หมดอายุ, ผู้เซ็นถูกระงับ |

**ทดสอบแล้วอย่างไร:** ไฟล์ที่ซีลผ่าน `pdfsig` (poppler) ว่า "Signature is Valid" และแก้ 1 byte แล้วไม่ผ่าน, token ของ TSA ผ่าน `openssl ts -verify` (ทดสอบกับ TSA จำลองที่สร้างด้วย `openssl ts -reply` เพราะเครื่องพัฒนาออกเน็ตไปหา TSA จริงไม่ได้), และเปิดผ่านเบราว์เซอร์จริงครบทั้งเส้นทาง (สร้าง → วางกรอบ → ส่ง → เซ็นบนมือถือ → ซีล → ตรวจไฟล์)

### ภาษาไทยใน PDF

pdf-lib วาดข้อความไทยผิด (วรรณยุกต์ลอย สระทับกัน) ตามที่ PRD เตือนไว้ ระบบนี้ใช้ fontkit จัดรูปข้อความตามตาราง GSUB/GPOS ของฟอนต์ Sarabun แล้ววาดทีละ glyph ตามตำแหน่งที่คำนวณได้ (`backend/src/documents/pdf/thai-text.ts`) ตัดบรรทัดภาษาไทยด้วย `Intl.Segmenter` ฟอนต์ Sarabun (OFL) อยู่ใน `backend/assets/fonts`

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

เฟส 3:

12. **ไฮไลต์อยู่ระดับคำโดยประมาณ** คำนวณตำแหน่งในบรรทัดจากจำนวนตัวอักษร (เผื่อขอบครึ่งตัวอักษร) ถ้าคำค้นข้ามบรรทัดจะเปิดหน้าถูกแต่ไม่ไฮไลต์
13. **ค้นในข้อความต้นฉบับ** (ก่อนเซ็น) ไม่ได้ค้นข้อความที่ผู้เซ็นพิมพ์ลงช่อง ค้นทั้งบริษัทเห็นเฉพาะเอกสารที่ส่งแล้ว (ร่างเป็นของผู้สร้าง)
14. **แผนก** ในตัวกรองหมายถึงแผนกของผู้สร้างเอกสาร
15. คำค้นต้องยาวอย่างน้อย 2 ตัวอักษร (หลังตัดช่องว่าง)

เฟส 2:

6. **เลยกำหนดแล้วยังเซ็นได้** (คำถามที่ยังเปิดใน PRD) เอกสารยังอยู่ในสถานะรอเซ็นพร้อมป้าย "เลยกำหนด"
7. **ส่งได้เมื่อผู้เซ็นทุกคนมีกรอบอย่างน้อย 1 กรอบ** และกรอบตราประทับต้องเป็นตราที่ผู้กรอกมีสิทธิ์ใช้
8. **ปฏิเสธได้เฉพาะเมื่อถึงลำดับของตัวเอง** และใช้ลายเซ็นเดียวกันกับทุกช่องลายเซ็นในการเซ็นครั้งนั้น
9. **ยกเลิกเอกสารได้ทั้งผู้สร้างและ Company Admin** (Admin ยกเลิกเอกสารคนอื่นถูกบันทึกใน audit log) ลบร่าง = ซ่อน ไม่ลบไฟล์
10. **TSA ล่ม → ซีลโดยไม่มีเวลา TSA**, ซีลล้มเหลวทั้งหมด → ปิดเอกสารแบบไม่ซีลและแจ้ง Admin (ไม่ทิ้งเอกสารค้าง)
11. ใบรับรองต้องเป็น **กุญแจ RSA** (ใบรับรองนิติบุคคลของ CA ไทยส่วนใหญ่เป็น RSA) ซีลเป็นระดับ **PAdES-B-B/B-T** ยังไม่ฝังข้อมูล OCSP/CRL สำหรับตรวจย้อนหลังระยะยาว (B-LT)

เฟส 1:

1. **ช่วงห้ามส่ง 21:00–08:00** ใช้กับข้อความอัตโนมัติ (เตือนใกล้ครบกำหนด เลยกำหนด ใบรับรองใกล้หมดอายุ) ส่วนข้อความที่ตอบสนองการกระทำของคน เช่นผลอนุมัติสมาชิก ส่งทันที เพราะ REG-06 กำหนด "ภายใน 1 นาที"
2. **แต่งตั้ง/ถอด Company Admin ได้เฉพาะ Super Admin** (ADM-03) Company Admin อนุมัติ ระงับ และแก้ข้อมูลพนักงานได้ แต่เปลี่ยนบทบาทไม่ได้
3. **นำเข้ารายชื่อ (ADM-07)**: แผนกหรือตำแหน่งในไฟล์ที่ยังไม่มีจะถูกสร้างให้เอง และคำขอที่รออยู่แล้วซึ่งรหัส + เบอร์ตรงกัน จะได้รับอนุมัติทันทีหลังนำเข้า
4. **แผนก/ตำแหน่งบังคับเลือก** เมื่อบริษัทมีรายการนั้นอย่างน้อย 1 รายการ ถ้ายังไม่มีเลยจะไม่ถาม
5. ข้อความยินยอม PDPA ใน `backend/src/users/consent.ts` เป็น **ร่าง** ให้ฝ่ายกฎหมาย/DPO ตรวจก่อนใช้จริง แก้ข้อความแล้วต้องเปลี่ยน `PDPA_CONSENT_VERSION` ทุกคนจะถูกถามใหม่

## รันบนเครื่องพัฒนา

ต้องมี Node.js 22 และ PostgreSQL 16

```bash
# 1) ฐานข้อมูล
psql -U postgres -c "CREATE USER zenhere WITH PASSWORD 'zenhere_dev';" -c "CREATE DATABASE zenhere OWNER zenhere;"
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
cd backend && npm test        # 64 เคส: unit, PDF/ซีล (ต้องมี openssl และ pdfsig), e2e กับ PostgreSQL จริง (สร้างฐาน zenhere_test_N ใหม่ทุกครั้ง)
cd frontend && npm test       # อัลกอริทึมไดคัทลายเซ็น 8 เคส
cd ocr-worker && python -m pytest tests   # OCR worker 5 เคส (ใช้โมเดล PP-OCRv3 แทน)
cd backend && SEARCH_BENCH=1 npx jest test/search.bench.spec.ts   # ความเร็วค้นหา 100,000 หน้า (ใช้ดิสก์ราว 1 GB)
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

## ใบรับรองดิจิทัลของบริษัท (ซีลเอกสาร)

1. ซื้อใบรับรองนิติบุคคลสำหรับลงนามเอกสารจาก CA (ไฟล์ .p12/.pfx กุญแจ RSA) ถ้าต้องการให้ Adobe Reader ขึ้นว่าเชื่อถือได้เลย ให้เลือก CA ที่อยู่ในรายการ Adobe AATL
2. Super Admin เข้า "หลังบ้าน Super Admin" → บริษัท → 🔐 ใบรับรองดิจิทัล → อัปโหลดไฟล์พร้อมรหัสผ่าน ระบบตรวจรหัสผ่านและวันหมดอายุก่อนบันทึก
3. ถ้า CA มีบริการ TSA ให้ใส่ URL ใน `TSA_URL` (และเปิด firewall ให้ server ออกไปหา host นั้นได้)

## ติดตั้งบน Windows Server

1. ติดตั้ง Node.js 22 LTS, PostgreSQL 16, [Caddy](https://caddyserver.com) และ [NSSM](https://nssm.cc)
2. วางโค้ดที่ `C:\zenhere` แล้ว `npm ci && npm run build` ทั้งใน `backend` และ `frontend`
3. สร้าง `backend\.env` จาก `.env.example` ตั้ง `NODE_ENV=production`, `DEV_LOGIN_ENABLED=false`, `APP_ORIGIN` และ `API_BASE_URL` เป็นโดเมนจริง
   - **สำรอง `FILE_ENCRYPTION_KEY` แยกไว้ที่ปลอดภัย** ถ้าหายจะเปิดลายเซ็นที่เก็บไว้ไม่ได้
4. `deploy\install-service.ps1` ติดตั้ง API เป็น Windows service ที่เริ่มใหม่เองเมื่อล่ม
5. แก้โดเมนใน `deploy\Caddyfile` แล้วติดตั้ง Caddy เป็น service (`nssm install caddy caddy.exe run --config C:\zenhere\deploy\Caddyfile`)
6. OCR: ติดตั้ง Python 3.12 และ `ocr-worker` ตาม `ocr-worker/README.md` แล้วรัน `deploy\install-ocr-service.ps1` และตั้ง `OCR_WORKER_URL=http://127.0.0.1:8090` ใน `backend\.env`
7. ตั้ง Task Scheduler ให้รัน `deploy\backup.ps1` ทุกคืน (pg_dump + สำเนาไฟล์ไป NAS เก็บ 30 วัน) และทดสอบกู้คืนทุกไตรมาส
8. ตั้งระบบ monitor ให้เรียก `https://<โดเมน>/api/health` และ `http://127.0.0.1:8090/health` (OCR) แล้วแจ้งผู้ดูแลเมื่อไม่ตอบ

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
| `POST /documents` · `GET /documents?companyId=&box=todo\|waiting\|done\|drafts\|company` | อัปโหลดและรายการเอกสาร |
| `GET/PATCH/DELETE /documents/:id` · `PUT /documents/:id/layout` · `POST /documents/:id/send` | รายละเอียด แก้ร่าง วางกรอบและผู้เซ็น ส่ง |
| `GET /documents/:id/file?v=source\|final\|original&download=1` | ไฟล์ (ตรวจสิทธิ์ทุกครั้ง) |
| `GET /documents/:id/signing` · `POST /documents/:id/sign` · `POST /documents/:id/decline` | หน้าเซ็น เซ็น ปฏิเสธ |
| `POST /documents/:id/remind` · `POST /documents/:id/void` · `POST /documents/:id/signers/:signerId/replace` | เตือนซ้ำ ยกเลิก เปลี่ยนผู้เซ็น |
| `GET /companies/:id/signer-candidates` · `GET/POST/PATCH /companies/:id/stamps` | ผู้เซ็นที่เลือกได้, ตราประทับ |
| `GET/POST /admin/companies/:id/certificates` · `POST /admin/certificates/:id/deactivate` | ใบรับรองดิจิทัล |
| `POST /verify` | ตรวจไฟล์ด้วย SHA-256 |
| `GET /search?q=&scope=mine\|company\|all&companyId=&status=&from=&to=&creatorId=&signerId=&departmentId=&docType=&tag=&overdue=` · `GET /search/facets` | ค้นหาเอกสารและเนื้อหา |
| `GET /documents/:id/pages/:pageNo/highlights?q=` | ตำแหน่งไฮไลต์คำค้นในหน้า |

## ต่อไป: เฟส 4 (นำร่อง + ขึ้นจริง)

- ดาวน์โหลดโมเดล OpenThai2.0-OCR-Text (เปิด huggingface.co) ตรวจค่าตั้งตาม model card และทดสอบกับเอกสารสแกนจริงของบริษัท
- ตั้ง LINE channel จริง ใบรับรองนิติบุคคลจริง และ TSA ของ CA แล้วทดสอบครบเส้นทางบนมือถือจริง (LINE in-app browser บน iOS/Android)
- นำร่องกับบริษัทเดียว เก็บ feedback ซ้อมสำรองและกู้คืนข้อมูล ทำคู่มือผู้ใช้
