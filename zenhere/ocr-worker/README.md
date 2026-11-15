# OCR worker (SRC-07)

บริการ Python แยกจาก API ฟังเฉพาะ `127.0.0.1` รับไฟล์ PDF + เลขหน้า แล้ว render หน้าเป็นรูปด้วย PDFium (`pypdfium2`)
และอ่านข้อความด้วยโมเดล ONNX แบบ PP-OCR (ตรวจหาบรรทัดข้อความ + อ่านทีละบรรทัดแบบ CTC) บน CPU เท่านั้น

API เรียกเองอัตโนมัติ: หน้าที่ดึงข้อความจาก PDF ได้น้อยกว่า 20 ตัวอักษร และไฟล์รูป จะถูกส่งเข้าคิว `document.ocr`
ทีละไม่เกิน 10 หน้า ถ้า worker ล่ม คิวจะลองใหม่ 6 ครั้ง (รอ 30 วินาทีถึง 8 นาที) ระหว่างนั้นผู้ใช้เห็น "กำลังอ่านเอกสาร"

## ติดตั้ง

```powershell
cd C:\zenhere\ocr-worker
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

## โมเดล OpenThai2.0-OCR-Text

ดาวน์โหลดจาก <https://huggingface.co/iapp/OpenThai2.0-OCR-Text> (ต้องเปิดให้ server เข้า huggingface.co ได้ ตามคำถามที่ยังเปิดใน PRD)
แล้ววางไว้ที่ `ocr-worker\models\` และตั้งค่าตัวแปร:

| ตัวแปร | ค่า |
|---|---|
| `OCR_DET_MODEL` | ไฟล์ ONNX ของตัวตรวจหาข้อความ (PP-OCR detector) |
| `OCR_REC_MODEL` | ไฟล์ ONNX ของตัวอ่านบรรทัดภาษาไทย (CTC recognizer) |
| `OCR_REC_KEYS` | ไฟล์รายการตัวอักษร (ถ้าโมเดลไม่ได้ฝังรายการตัวอักษรไว้ใน metadata) |
| `OCR_REC_HEIGHT` | ความสูงรูปบรรทัดที่ตัวอ่านต้องการ (ค่าเริ่มต้น 48) |
| `OCR_DET_LIMIT` | ด้านยาวสุดของรูปก่อนตรวจหาข้อความ (ค่าเริ่มต้น 960) |
| `OCR_USE_SPACE_CHAR` | `true` ถ้ารายการตัวอักษรของโมเดลมีช่องว่างต่อท้าย (แบบ PaddleOCR) |
| `OCR_TEXT_SCORE` | ตัดบรรทัดที่ความมั่นใจต่ำกว่านี้ (ค่าเริ่มต้น 0.5) |
| `OCR_THREADS` | จำนวน thread ต่อ process (0 = อัตโนมัติ) |
| `OCR_TOKEN` | ถ้าตั้ง API ต้องส่ง header `X-OCR-Token` เดียวกัน (`OCR_WORKER_TOKEN` ฝั่ง API) |

> **ต้องตรวจกับ model card ก่อนใช้จริง:** ตอนพัฒนาเครื่องนี้เข้า huggingface.co ไม่ได้ จึงเขียนตามสถาปัตยกรรม PP-OCR มาตรฐาน
> (detector ใช้ค่า normalize แบบ ImageNet, recognizer สูง 48 px normalize เป็น -1..1) ทุกค่าตั้งได้ผ่านตัวแปรข้างบน
> ถ้า model card ระบุต่างจากนี้ให้ปรับตามนั้น แล้วทดสอบกับเอกสารสแกนจริงของบริษัท (PRD ระบุว่าความแม่นยำที่ประกาศมาจากผู้พัฒนาเอง)

## รัน

```powershell
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8090
curl http://127.0.0.1:8090/health
```

ฝั่ง API ตั้ง `OCR_WORKER_URL=http://127.0.0.1:8090` ถ้าไม่ตั้ง ระบบจะไม่ OCR (หน้าสแกนค้นเนื้อหาไม่ได้ แต่ค้นชื่อเอกสารได้)
ติดตั้งเป็น Windows service ด้วย `..\deploy\install-ocr-service.ps1`

แต่ละ process อ่านทีละหน้าและกินแรมราว 450 MB (ตามที่ model card ระบุ) ถ้าต้องการอ่านเร็วขึ้นให้รันหลาย process
คนละ port แล้วทำ load balance หรือเพิ่ม `OCR_THREADS`

## ทดสอบ

```bash
pip install -r requirements-dev.txt
python -m pytest tests
```

เทสต์ใช้โมเดล PP-OCRv3 (จีน/อังกฤษ) ที่มากับแพ็กเกจ `rapidocr_onnxruntime` แทน เพราะสถาปัตยกรรมเดียวกัน
เพื่อตรวจว่าการ render หน้า (รวมหน้าที่หมุน) การตรวจหาบรรทัด การอ่าน และพิกัดกรอบถูกต้อง
