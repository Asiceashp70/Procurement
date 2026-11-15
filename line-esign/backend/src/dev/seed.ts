/**
 * Demo data for testing without LINE:  npm run seed:demo
 * Uses the real services, so everything goes through the same rules as the app.
 * Safe to run twice: does nothing when the demo company already exists.
 */
process.env.JOB_WORKER_ENABLED = 'false';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AdminService } from '../admin/admin.service';
import { CertificatesService } from '../admin/certificates.service';
import { AppModule } from '../app.module';
import { CompaniesService } from '../companies/companies.service';
import { StampsService } from '../companies/stamps.service';
import { config } from '../config/config';
import { DB, type Db } from '../db/database';
import { migrate } from '../db/migrate';
import type { User } from '../db/types';
import { DocumentsService } from '../documents/documents.service';
import { SigningService } from '../documents/signing.service';
import { JobsService } from '../jobs/jobs.service';
import { currentConsent } from '../users/consent';
import { SignaturesService } from '../users/signatures.service';
import { UsersService } from '../users/users.service';
import { signaturePng, stampPng, testCertificateP12, thaiPdf } from './demo-assets';

const COMPANY = 'บริษัท ทดลองระบบ จำกัด';
const meta = { ip: '127.0.0.1', userAgent: 'demo-seed' };
const lineId = (n: number) => 'U' + n.toString(16).padStart(32, '0');

interface Person {
  n: number;
  first: string;
  last: string;
  nick: string;
  dept?: string;
  pos?: string;
  code?: string;
  canCreate?: boolean;
  pendingOnly?: boolean;
}

const PEOPLE: Person[] = [
  { n: 1, first: 'ธวัช', last: 'ผู้ดูแลระบบ', nick: 'วัช' }, // Super Admin (SUPER_ADMIN_LINE_USER_IDS)
  { n: 2, first: 'มาลี', last: 'ใจดี', nick: 'มาลี', dept: 'ฝ่ายบุคคล', pos: 'หัวหน้าแผนก', code: 'HR001' }, // Company Admin
  { n: 3, first: 'วิชัย', last: 'มั่นคง', nick: 'ชัย', dept: 'ฝ่ายผลิต', pos: 'ผู้จัดการ', code: 'PD001', canCreate: true },
  { n: 4, first: 'สมชาย', last: 'รักงาน', nick: 'ชาย', dept: 'ฝ่ายผลิต', pos: 'พนักงาน', code: 'PD042' },
  { n: 5, first: 'สมหญิง', last: 'ตั้งใจ', nick: 'หญิง', dept: 'บัญชี', pos: 'พนักงาน', code: 'AC007' },
  { n: 6, first: 'น้องใหม่', last: 'เพิ่งมา', nick: 'ใหม่', dept: 'ฝ่ายผลิต', pos: 'พนักงาน', code: 'PD099', pendingOnly: true },
];

async function main() {
  await migrate(config().DATABASE_URL, () => undefined);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Db>(DB);
  const g = <T>(cls: new (...args: never[]) => T) => app.get(cls);

  if (await db.selectFrom('companies').select('id').where('name', '=', COMPANY).executeTakeFirst()) {
    console.log(`"${COMPANY}" already exists: nothing to do. Drop the database to start over.`);
    await app.close();
    return;
  }
  if (!config().superAdminLineUserIds.has(lineId(1))) {
    console.warn(`! SUPER_ADMIN_LINE_USER_IDS should contain ${lineId(1)} so the first demo account is Super Admin`);
  }

  const users = g(UsersService);
  const signatures = g(SignaturesService);
  const reload = (id: string) => db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  // ---- people: LINE login + signature + registration
  const u: Record<number, User> = {};
  for (const p of PEOPLE) {
    let user = await users.upsertFromLine({ lineUserId: lineId(p.n), displayName: p.first, pictureUrl: null, isFriend: p.n !== 5 });
    await signatures.create(user, 'draw', signaturePng(p.n, p.n % 2 ? [17, 17, 17] : [18, 52, 160]));
    await users.register(
      user,
      { firstName: p.first, lastName: p.last, nickname: p.nick, phone: `08100000${String(p.n).padStart(2, '0')}`, email: `demo${p.n}@example.com`, consentVersion: currentConsent().version },
      meta,
    );
    user = await reload(user.id);
    u[p.n] = user;
  }
  const superAdmin = u[1];

  // ---- company, lists, admins
  const admin = g(AdminService);
  const companies = g(CompaniesService);
  const company = await admin.createCompany(superAdmin, { name: COMPANY, taxId: '0105556000017', address: '99 ถนนทดสอบ แขวงตัวอย่าง เขตทดลอง กรุงเทพฯ 10110' }, meta);
  const depts: Record<string, string> = {};
  for (const name of ['ฝ่ายบุคคล', 'ฝ่ายผลิต', 'บัญชี']) depts[name] = (await companies.createListItem(superAdmin, company.id, 'departments', { name }, meta)).id;
  const positions: Record<string, string> = {};
  for (const name of ['ผู้จัดการ', 'หัวหน้าแผนก', 'พนักงาน']) positions[name] = (await companies.createListItem(superAdmin, company.id, 'positions', { name }, meta)).id;
  await admin.appointAdmin(superAdmin, company.id, u[1].id, meta);
  await admin.appointAdmin(superAdmin, company.id, u[2].id, meta);
  await db
    .updateTable('memberships')
    .set({ employee_code: 'HR001', department_id: depts['ฝ่ายบุคคล'], position_id: positions['หัวหน้าแผนก'] })
    .where('user_id', '=', u[2].id)
    .execute();

  // ---- employees ask to join with the 8-digit code; the admin approves (except the newcomer)
  const { invite_code: code } = await db.selectFrom('companies').select('invite_code').where('id', '=', company.id).executeTakeFirstOrThrow();
  const hr = await reload(u[2].id);
  for (const p of PEOPLE.filter((x) => x.n >= 3)) {
    const joined = await companies.join(u[p.n], { code, employeeCode: p.code!, departmentId: depts[p.dept!], positionId: positions[p.pos!] }, meta);
    if (!p.pendingOnly) await companies.updateMembership(hr, joined.id, { status: 'approved', canCreateDocuments: p.canCreate }, meta);
  }

  // ---- stamp and test certificate
  await g(StampsService).create(hr, company.id, 'ตราบริษัท (แดง)', stampPng(), [u[2].id, u[3].id], meta);
  const certPassword = 'demo1234';
  await g(CertificatesService).upload(superAdmin, company.id, testCertificateP12('Demo Test Company Co., Ltd. (TEST ONLY)', certPassword), certPassword, meta);

  // ---- documents
  const docs = g(DocumentsService);
  const signing = g(SigningService);
  const days = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();
  const upload = async (by: User, name: string, pdf: Buffer, info: { title: string; docType: string; tags: string[] }) =>
    (await docs.create(by, company.id, { originalname: Buffer.from(name, 'utf8').toString('latin1'), buffer: pdf, mimetype: 'application/pdf' }, meta, info)).id;

  // 1) employment contract: Somchai signs first, then the manager signs and stamps
  const contract = await upload(
    hr,
    'สัญญาจ้าง-สมชาย.pdf',
    await thaiPdf(
      'สัญญาจ้างแรงงาน',
      [
        [
          `สัญญาฉบับนี้ทำขึ้นระหว่าง ${COMPANY} ซึ่งต่อไปในสัญญานี้เรียกว่า "นายจ้าง" ฝ่ายหนึ่ง กับ นายสมชาย รักงาน ซึ่งต่อไปเรียกว่า "ลูกจ้าง" อีกฝ่ายหนึ่ง`,
          'ข้อ 1. นายจ้างตกลงจ้างลูกจ้างในตำแหน่งพนักงานฝ่ายผลิต เริ่มงานตั้งแต่วันที่ 1 ธันวาคม 2569',
          'ข้อ 2. นายจ้างตกลงจ่ายค่าจ้างเดือนละ 18,500 บาท ทุกวันที่ ๒๕ ของเดือน',
          'ข้อ 3. ลูกจ้างมีสิทธิ์ลาป่วยและลากิจตามกฎหมายคุ้มครองแรงงาน และได้รับสวัสดิการประกันสังคม',
        ],
        ['ข้อ 4. ลูกจ้างต้องรักษาความลับทางการค้าของนายจ้าง', '', '', '', '', '', '', 'ลงชื่อ ......................................... ลูกจ้าง', '', '', 'ลงชื่อ ......................................... นายจ้าง'],
      ],
      'เอกสารตัวอย่างสำหรับทดสอบระบบ',
    ),
    { title: 'สัญญาจ้างแรงงาน สมชาย รักงาน', docType: 'สัญญาจ้าง', tags: ['HR', '2569'] },
  );
  const stampId = (await db.selectFrom('company_stamps').select('id').executeTakeFirstOrThrow()).id;
  await docs.updateDraft(hr, contract, { dueAt: days(5), signingMode: 'sequential' });
  await docs.saveLayout(hr, contract, {
    signers: [
      { userId: u[4].id, order: 1 },
      { userId: u[3].id, order: 2 },
    ],
    fields: [
      { id: randomUUID(), signerUserId: u[4].id, pageNo: 2, type: 'signature', x: 0.2, y: 0.37, w: 0.3, h: 0.07 },
      { id: randomUUID(), signerUserId: u[4].id, pageNo: 2, type: 'date', x: 0.55, y: 0.4, w: 0.2, h: 0.025 },
      { id: randomUUID(), signerUserId: u[4].id, pageNo: 1, type: 'text', x: 0.1, y: 0.62, w: 0.5, h: 0.03, settings: { label: 'เลขบัตรประชาชน', required: true, maxLength: 13 } },
      { id: randomUUID(), signerUserId: u[4].id, pageNo: 1, type: 'checkbox', x: 0.1, y: 0.67, w: 0.025, h: 0.018, settings: { label: 'รับทราบเงื่อนไข', required: true } },
      { id: randomUUID(), signerUserId: u[3].id, pageNo: 2, type: 'signature', x: 0.2, y: 0.46, w: 0.3, h: 0.07 },
      { id: randomUUID(), signerUserId: u[3].id, pageNo: 2, type: 'stamp', x: 0.62, y: 0.43, w: 0.16, h: 0.11, settings: { stampId } },
    ],
  });
  await docs.send(hr, contract, meta);

  // 2) purchase memo: both signed already -> completed and sealed once the API runs the queue
  const memo = await upload(
    u[3],
    'บันทึกขออนุมัติซื้อ.pdf',
    await thaiPdf('บันทึกข้อความ ขออนุมัติจัดซื้ออุปกรณ์', [
      [
        'เรียน ผู้จัดการฝ่ายบัญชี',
        'ฝ่ายผลิตขออนุมัติจัดซื้อเครื่องมือวัดความหนาจำนวน 2 เครื่อง ราคารวม 45,600 บาท (รวมภาษีมูลค่าเพิ่มแล้ว) เพื่อใช้ตรวจสอบคุณภาพสินค้า',
        'จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ',
      ],
    ]),
    { title: 'ขออนุมัติจัดซื้อเครื่องมือวัด', docType: 'บันทึกข้อความ', tags: ['จัดซื้อ'] },
  );
  await docs.updateDraft(u[3], memo, { dueAt: days(3), signingMode: 'parallel' });
  await docs.saveLayout(u[3], memo, {
    signers: [
      { userId: u[3].id, order: 1 },
      { userId: u[5].id, order: 1 },
    ],
    fields: [
      { id: randomUUID(), signerUserId: u[3].id, pageNo: 1, type: 'signature', x: 0.12, y: 0.55, w: 0.3, h: 0.07 },
      { id: randomUUID(), signerUserId: u[5].id, pageNo: 1, type: 'signature', x: 0.58, y: 0.55, w: 0.3, h: 0.07 },
      { id: randomUUID(), signerUserId: u[5].id, pageNo: 1, type: 'date', x: 0.62, y: 0.63, w: 0.22, h: 0.025 },
    ],
  });
  await docs.send(u[3], memo, meta);
  await signing.sign(await reload(u[3].id), memo, { values: {}, useSavedSignature: true, consent: true }, undefined, meta);
  await signing.sign(await reload(u[5].id), memo, { values: {}, useSavedSignature: true, consent: true }, undefined, meta);

  // 3) a notice waiting for Somying, due tomorrow (to test "due soon")
  const notice = await upload(
    hr,
    'ประกาศวันหยุด.pdf',
    await thaiPdf('ประกาศ เรื่อง วันหยุดประจำปี 2570', [['บริษัทกำหนดวันหยุดประจำปี 2570 จำนวน 16 วัน ตามรายละเอียดแนบท้ายประกาศนี้ ขอให้พนักงานทุกคนลงชื่อรับทราบ']]),
    { title: 'ประกาศวันหยุดประจำปี 2570', docType: 'ประกาศ', tags: ['HR'] },
  );
  await docs.updateDraft(hr, notice, { dueAt: days(1), signingMode: 'parallel' });
  await docs.saveLayout(hr, notice, {
    signers: [{ userId: u[5].id, order: 1 }],
    fields: [{ id: randomUUID(), signerUserId: u[5].id, pageNo: 1, type: 'signature', x: 0.55, y: 0.5, w: 0.3, h: 0.07 }],
  });
  await docs.send(hr, notice, meta);

  // 4) a draft for Malee to finish in the editor
  await upload(hr, 'ใบลา.pdf', await thaiPdf('แบบฟอร์มใบลา', [['ข้าพเจ้า ............................ ตำแหน่ง ............................', 'ขอลา ( ) ป่วย ( ) กิจ ( ) พักร้อน ตั้งแต่วันที่ ............... ถึงวันที่ ...............', 'เหตุผล ..................................................................................']]), {
    title: 'แบบฟอร์มใบลา (ร่าง)',
    docType: 'ใบลา',
    tags: [],
  });

  // finish background work now: text extraction, final PDF + seal, the "LINE" messages
  const jobs = g(JobsService);
  while ((await jobs.runOnce()) > 0);

  await app.close();
  console.log(`
Demo data ready: ${COMPANY} (code ${code})
Log in on the login page as:
  ${lineId(1)}  ธวัช      Super Admin + company admin
  ${lineId(2)}  มาลี      Company Admin (HR), sends documents
  ${lineId(3)}  วิชัย     manager, can create documents, may use the stamp
  ${lineId(4)}  สมชาย    has a contract to sign
  ${lineId(5)}  สมหญิง   has a notice due tomorrow (not friends with the OA)
  ${lineId(6)}  น้องใหม่  waiting for approval
Test certificate password: ${certPassword} (self-signed, for testing only)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
