# Technical Requirements Document (TRD)
**Project Name:** ระบบบริหารจัดการการผลิต (Production Management System)
**Prepared for:** ทีมพัฒนาระบบ (Antigravity Team)

## 1. ภาพรวมของระบบ (System Overview)
ระบบ Production Management ถูกออกแบบมาเพื่อเพิ่มประสิทธิภาพในการบริหารจัดการกระบวนการผลิต ประกอบด้วย 4 ระบบหลักที่ทำงานร่วมกัน ได้แก่:
- **Centralized Task Management:** ระบบหลังบ้าน (Web Application) สำหรับแอดมินเพื่อสร้างและจ่ายงาน
- **Employee Operation Application:** แอปพลิเคชันบนมือถือ (Mobile Application) สำหรับพนักงานหน้างานเพื่อรับงานและอัปเดตสถานะ
- **Real-time Monitoring Dashboard:** หน้าจอแสดงผล (PDS) สำหรับติดตามสถานะการทำงานแบบเรียลไทม์
- **Automated Notification System:** ระบบแจ้งเตือนอัตโนมัติผ่าน Telegram

## 2. สถาปัตยกรรมและเทคโนโลยีที่แนะนำ (Recommended Tech Stack)
ให้ทีม Antigravity พิจารณาปรับใช้ตามความถนัดและความเหมาะสมของโปรเจกต์
- **Frontend (Web Admin & Dashboard):** React.js, Vue.js หรือ Next.js
- **Frontend (Mobile App):** Flutter หรือ React Native (รองรับทั้ง iOS และ Android)
- **Backend:** Node.js (Express/NestJS), Python (FastAPI/Django) หรือ Go
- **Database:**
  - *Relational DB:* PostgreSQL หรือ MySQL (สำหรับเก็บข้อมูล User, Task, Project)
  - *In-Memory DB:* Redis (สำหรับการจัดการคิวและ Real-time data)
- **Real-time Communication:** WebSockets (เช่น Socket.io) หรือ Server-Sent Events (SSE)
- **Third-party Integration:** Telegram Bot API (สำหรับ Notification)

## 3. ความต้องการด้านฟังก์ชันการทำงาน (Functional Requirements)
### 3.1 Centralized Task Management (Web Admin)
- **Authentication & Authorization:** ระบบ Login และจัดการสิทธิ์ผู้ใช้งานแบบ Role-Based Access Control (RBAC) เช่น Admin, Manager, Supervisor
- **Project & Task Management:**
  - สามารถสร้าง แก้ไข ลบ (CRUD) โปรเจกต์และรายการงาน (Tasks) ได้
  - สามารถจัดกลุ่ม หมวดหมู่ และกำหนดลำดับความสำคัญของงาน (Priority)
  - สามารถมอบหมายงาน (Assign) ให้กับพนักงานหรือแผนกได้
- **Job Code Generation:** ระบบสามารถสร้าง QR Code หรือ Barcode สำหรับใบสั่งงาน (Paper Job Code) เพื่อให้พนักงานนำไปสแกนได้

### 3.2 Employee Operation Application (Mobile App)
- **User Authentication:** พนักงานสามารถ Login เข้าสู่ระบบได้ (อาจใช้ PIN หรือ Employee ID)
- **QR/Barcode Scanner:** สามารถเปิดกล้องมือถือเพื่อสแกน Paper Job Code บนใบสั่งงานได้
- **Task Execution:**
  - ดึงข้อมูลรายละเอียดของงานที่สแกนมาแสดงผล
  - มีปุ่มควบคุมสถานะการทำงาน เช่น "กดรับงาน" (Accept), "เริ่มงาน" (Start), "พักเบรก/หยุดชั่วคราว" (Pause), "งานเสร็จสิ้น" (Complete)
  - มีฟังก์ชันสำหรับรายงานปัญหา (Report Issue/Defect) พร้อมแนบรูปถ่าย

### 3.3 Real-time Monitoring Dashboard (PDS)
- **Live Tracking:** แสดงสถานะของแต่ละโปรเจกต์และงานย่อยแบบ Real-time โดยไม่ต้อง Refresh หน้าจอ
- **Metrics & Visualization:**
  - แสดง Progress Bar ความคืบหน้าของแต่ละโปรเจกต์
  - แสดงปริมาณงานที่ทำสำเร็จ (Completed Tasks) เทียบกับเป้าหมาย
  - Highlight แจ้งเตือนจุดที่เป็น "คอขวด" (Bottleneck) หรือสถานีงานที่ล่าช้ากว่ากำหนด

### 3.4 Automated Notification System
- **Event Triggering:** ระบบตรวจจับการเปลี่ยนแปลงสถานะ (State changes) จากฐานข้อมูล
- **Telegram Integration:** ส่งข้อความแจ้งเตือนไปยังกลุ่ม Telegram หรือแชทส่วนตัวที่กำหนดไว้ โดยมี Event หลักๆ ดังนี้:
  - มีการเริ่มงานใหม่ (Task Started)
  - งานเสร็จสิ้น (Task Completed)
  - พบปัญหา/เครื่องจักรขัดข้อง (Issue Reported)
  - งานล่าช้ากว่ากำหนด (Task Overdue)

## 4. ความต้องการที่ไม่ใช่ฟังก์ชันการทำงาน (Non-Functional Requirements)
- **Performance (ประสิทธิภาพ):**
  - หน้า Dashboard ต้องอัปเดตข้อมูลภายใน 1-2 วินาทีหลังจากพนักงานกดอัปเดตสถานะที่ Mobile App
  - API Response Time ควรต่ำกว่า 500ms
- **Security (ความปลอดภัย):**
  - การสื่อสารระหว่าง Client และ Server ต้องผ่าน HTTPS (TLS/SSL)
  - ใช้ JWT (JSON Web Token) สำหรับการทำ API Authentication
- **Scalability:** โครงสร้าง Backend ควรออกแบบในลักษณะที่สามารถ Scale ได้ (เช่น Docker Containers) เพื่อรองรับจำนวนพนักงานและปริมาณ Transaction ที่อาจเพิ่มขึ้นในอนาคต

## 5. แผนการส่งมอบที่คาดหวัง (Expected Deliverables from Antigravity)
- System Architecture Diagram & Database Schema (ERD)
- API Documentation (เช่น Swagger/OpenAPI)
- UI/UX Wireframes หรือ Prototypes สำหรับการรีวิวก่อนพัฒนาจริง
- Source Code (อัปโหลดบน Git Repository เช่น GitHub/GitLab)
- UAT (User Acceptance Testing) Environment สำหรับให้ทีมงานทดสอบ
