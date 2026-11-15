import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { makePng, nextLineId, ORIGIN, resetDatabase, SUPER_ADMIN_LINE_ID, TEST_DB_URL, useTestConfig } from './helpers';

// config must be in place before app modules read it
useTestConfig();
import { createApp } from '../src/app.factory';
import { DB, type Db } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { JobsService } from '../src/jobs/jobs.service';

type Agent = ReturnType<typeof request.agent>;

let app: INestApplication;
let db: Db;
let jobs: JobsService;

/** A logged-in browser: keeps the session cookie and always sends the app's Origin. */
async function login(lineUserId = nextLineId(), displayName = 'Tester') {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/dev/login').set('origin', ORIGIN).send({ lineUserId, displayName }).expect(200);
  return agent;
}

const post = (a: Agent, url: string) => a.post(url).set('origin', ORIGIN);
const patch = (a: Agent, url: string) => a.patch(url).set('origin', ORIGIN);

let phoneCounter = 812345000;
async function registeredUser(first = 'สมชาย', lineUserId = nextLineId()) {
  const agent = await login(lineUserId, first);
  await post(agent, '/api/me/signatures').field('method', 'draw').attach('file', makePng(300, 120), 'sig.png').expect(201);
  const phone = '0' + phoneCounter++;
  const me = await post(agent, '/api/me/register')
    .send({ firstName: first, lastName: 'ใจดี', phone, email: `user${phoneCounter}@example.com`, consentVersion: '2026-11-v1', consentAccepted: true })
    .expect(201);
  return { agent, id: me.body.id as string, phone };
}

beforeAll(async () => {
  await resetDatabase();
  await migrate(TEST_DB_URL, () => undefined);
  app = await createApp();
  await app.init();
  db = app.get(DB);
  jobs = app.get(JobsService);
});

afterAll(async () => {
  await app?.close();
});

describe('security basics', () => {
  it('rejects requests without a session', async () => {
    await request(app.getHttpServer()).get('/api/me').expect(401);
  });

  it('rejects state-changing requests from another origin', async () => {
    const agent = await login();
    await agent.post('/api/me/consent').set('origin', 'https://evil.example').send({ version: '2026-11-v1' }).expect(403);
    await agent.post('/api/me/consent').send({ version: '2026-11-v1' }).expect(403); // no Origin at all
  });

  it('keeps unregistered users out of company features', async () => {
    const agent = await login();
    const res = await agent.get('/api/companies/lookup?code=12345678').expect(403);
    expect(res.body.code).toBe('REGISTRATION_REQUIRED');
  });

  it('grants Super Admin only from server config', async () => {
    const admin = await login(SUPER_ADMIN_LINE_ID);
    expect((await admin.get('/api/me')).body.isSuperAdmin).toBe(true);
    const normal = await login();
    expect((await normal.get('/api/me')).body.isSuperAdmin).toBe(false);
    await normal.get('/api/admin/companies').expect(403);
  });
});

describe('registration and signatures', () => {
  it('requires a signature and valid fields before registering (REG-01, REG-03)', async () => {
    const agent = await login();
    const body = { firstName: 'ทดสอบ', lastName: 'ระบบ', phone: '081-234-5678', email: 'a@b.co', consentVersion: '2026-11-v1', consentAccepted: true };
    const noSig = await post(agent, '/api/me/register').send(body).expect(400);
    expect(noSig.body.code).toBe('SIGNATURE_REQUIRED');

    await post(agent, '/api/me/signatures').field('method', 'draw').attach('file', Buffer.from('not a png'), 'x.png').expect(400);
    await post(agent, '/api/me/signatures').field('method', 'upload').attach('file', makePng(400, 150), 'sig.png').expect(201);

    const bad = await post(agent, '/api/me/register').send({ ...body, phone: '12', email: 'nope' }).expect(400);
    expect(bad.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['email', 'phone']);
    await post(agent, '/api/me/register').send({ ...body, consentVersion: 'old' }).expect(400);

    const ok = await post(agent, '/api/me/register').send(body).expect(201);
    expect(ok.body.registered).toBe(true);
    expect(ok.body.phone).toBe('0812345678');
    expect(ok.body.needsConsent).toBe(false);
    const consent = await db.selectFrom('consents').selectAll().where('user_id', '=', ok.body.id).execute();
    expect(consent).toHaveLength(1);
    expect(consent[0].consent_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps one active signature with history, readable only by its owner (SIG-06)', async () => {
    const { agent } = await registeredUser('ลายเซ็น');
    const png = makePng(320, 100);
    await post(agent, '/api/me/signatures').field('method', 'upload').attach('file', png, 'b.png').expect(201);
    const list = (await agent.get('/api/me/signatures').expect(200)).body;
    expect(list).toHaveLength(2);
    expect(list.filter((s: { isActive: boolean }) => s.isActive)).toHaveLength(1);
    const active = list.find((s: { isActive: boolean }) => s.isActive);

    const img = await agent.get(`/api/me/signatures/${active.id}/image`).expect(200);
    expect(Buffer.compare(img.body, png)).toBe(0);
    expect(img.headers['cache-control']).toContain('no-store');

    const other = await login();
    await other.get(`/api/me/signatures/${active.id}/image`).expect(404);
    // stored encrypted, not as a plain PNG
    const row = await db.selectFrom('signatures').select('storage_key').where('id', '=', active.id).executeTakeFirstOrThrow();
    expect(row.storage_key.endsWith('.enc')).toBe(true);
  });
});

describe('companies, joining and approval', () => {
  let superAdmin: Agent;
  let companyAdmin: { agent: Agent; id: string };
  let companyId: string;
  let code: string;
  let deptId: string;
  let posId: string;

  beforeAll(async () => {
    superAdmin = (await registeredUser('ซุปเปอร์', SUPER_ADMIN_LINE_ID)).agent;
    companyAdmin = await registeredUser('แอดมิน');
  });

  it('Super Admin creates a company with a valid tax id (ADM-01)', async () => {
    await post(superAdmin, '/api/admin/companies').send({ name: 'บริษัท ทดสอบ จำกัด', taxId: '1234567890123' }).expect(400);
    const res = await post(superAdmin, '/api/admin/companies').send({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0105556000017', address: 'กรุงเทพฯ' }).expect(201);
    companyId = res.body.id;
  });

  it('appoints a Company Admin, who can manage lists and see the invite (ADM-02, ADM-03, ADM-05)', async () => {
    await companyAdmin.agent.get(`/api/companies/${companyId}/dashboard`).expect(403);
    await post(superAdmin, `/api/admin/companies/${companyId}/admins`).send({ userId: companyAdmin.id }).expect(201);
    await companyAdmin.agent.get(`/api/companies/${companyId}/dashboard`).expect(200);

    deptId = (await post(companyAdmin.agent, `/api/companies/${companyId}/departments`).send({ name: 'บัญชี' }).expect(201)).body.id;
    await post(companyAdmin.agent, `/api/companies/${companyId}/departments`).send({ name: 'บัญชี' }).expect(409);
    posId = (await post(companyAdmin.agent, `/api/companies/${companyId}/positions`).send({ name: 'พนักงาน' }).expect(201)).body.id;

    const invite = (await companyAdmin.agent.get(`/api/companies/${companyId}/invite`).expect(200)).body;
    expect(invite.code).toMatch(/^\d{8}$/);
    expect(invite.link).toMatch(new RegExp(`^${ORIGIN}/join/`));
    code = invite.code;
  });

  it('employee joins with the code, waits for approval and is told on LINE (REG-02, REG-04, REG-06)', async () => {
    const emp = await registeredUser('พนักงาน');
    const lookup = (await emp.agent.get(`/api/companies/lookup?code=${code}`).expect(200)).body;
    expect(lookup.name).toBe('บริษัท ทดสอบ จำกัด');
    expect(lookup.departments.map((d: { name: string }) => d.name)).toEqual(['บัญชี']);

    await post(emp.agent, '/api/companies/join').send({ code, employeeCode: 'E001' }).expect(400); // department required
    const joined = (await post(emp.agent, '/api/companies/join').send({ code, employeeCode: 'E001', departmentId: deptId, positionId: posId }).expect(201)).body;
    expect(joined.status).toBe('pending');
    await post(emp.agent, '/api/companies/join').send({ code, employeeCode: 'E001', departmentId: deptId, positionId: posId }).expect(409);

    // same employee code by someone else is refused
    const other = await registeredUser('ซ้ำ');
    await post(other.agent, '/api/companies/join').send({ code, employeeCode: 'e001', departmentId: deptId, positionId: posId }).expect(409);

    // members cannot use company admin features
    await emp.agent.get(`/api/companies/${companyId}/members`).expect(403);

    const pending = (await companyAdmin.agent.get(`/api/companies/${companyId}/members?status=pending`).expect(200)).body;
    expect(pending.map((m: { employeeCode: string }) => m.employeeCode)).toContain('E001');

    await patch(companyAdmin.agent, `/api/memberships/${joined.id}`).send({ status: 'approved' }).expect(200);
    const me = (await emp.agent.get('/api/me')).body;
    expect(me.memberships[0]).toMatchObject({ companyId, status: 'approved', departmentName: 'บัญชี', canCreateDocuments: false });

    const before = await db.selectFrom('notifications').selectAll().where('user_id', '=', emp.id).execute();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ type: 'membership.approved', status: 'pending' });
    await jobs.runOnce();
    const after = await db.selectFrom('notifications').selectAll().where('user_id', '=', emp.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('sent');

    // ADM-06: permission toggle is logged
    await patch(companyAdmin.agent, `/api/memberships/${joined.id}`).send({ canCreateDocuments: true }).expect(200);
    const log = (await companyAdmin.agent.get(`/api/companies/${companyId}/audit`).expect(200)).body;
    const actions = log.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['membership.requested', 'membership.approved', 'membership.create_permission_granted']));
  });

  it('rejection needs a reason; suspended members cannot use the company (ADM-04)', async () => {
    const emp = await registeredUser('ปฏิเสธ');
    const joined = (await post(emp.agent, '/api/companies/join').send({ code, employeeCode: 'E002', departmentId: deptId, positionId: posId }).expect(201)).body;
    await patch(companyAdmin.agent, `/api/memberships/${joined.id}`).send({ status: 'rejected' }).expect(400);
    await patch(companyAdmin.agent, `/api/memberships/${joined.id}`).send({ status: 'rejected', rejectReason: 'รหัสพนักงานไม่ถูกต้อง' }).expect(200);
    const n = await db.selectFrom('notifications').selectAll().where('user_id', '=', emp.id).executeTakeFirstOrThrow();
    expect(n.type).toBe('membership.rejected');
    // may apply again after a rejection
    const again = (await post(emp.agent, '/api/companies/join').send({ code, employeeCode: 'E002', departmentId: deptId, positionId: posId }).expect(201)).body;
    expect(again.status).toBe('pending');
    await patch(companyAdmin.agent, `/api/memberships/${again.id}`).send({ status: 'approved' }).expect(200);
    await emp.agent.get(`/api/companies/${companyId}/departments`).expect(200);
    await patch(companyAdmin.agent, `/api/memberships/${again.id}`).send({ status: 'suspended' }).expect(200);
    await emp.agent.get(`/api/companies/${companyId}/departments`).expect(403);
    await post(emp.agent, '/api/companies/join').send({ code, employeeCode: 'E002', departmentId: deptId, positionId: posId }).expect(403);
  });

  it('keeps at least one admin per company (ADM-03)', async () => {
    const m = await db.selectFrom('memberships').select('id').where('user_id', '=', companyAdmin.id).executeTakeFirstOrThrow();
    await patch(companyAdmin.agent, `/api/memberships/${m.id}`).send({ status: 'suspended' }).expect(400);
    await superAdmin.delete(`/api/admin/companies/${companyId}/admins/${companyAdmin.id}`).set('origin', ORIGIN).expect(400);
  });

  it('rotating the invite stops the old code immediately (ADM-02)', async () => {
    const fresh = (await post(companyAdmin.agent, `/api/companies/${companyId}/invite/rotate`).expect(201)).body;
    expect(fresh.code).not.toBe(code);
    const emp = await registeredUser('รหัสเก่า');
    await emp.agent.get(`/api/companies/lookup?code=${code}`).expect(404);
    await emp.agent.get(`/api/companies/lookup?code=${fresh.code}`).expect(200);
    code = fresh.code;
  });

  it('auto-approves a pre-imported employee whose code and phone match (ADM-07)', async () => {
    const emp = await registeredUser('นำเข้า');
    // a request made before the import is approved by the import
    const early = await registeredUser('มาก่อน');
    const earlyJoin = (await post(early.agent, '/api/companies/join').send({ code, employeeCode: 'E101', departmentId: deptId, positionId: posId }).expect(201)).body;
    expect(earlyJoin.status).toBe('pending');

    const phoneFmt = (p: string) => `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
    const csv = [
      'รหัสพนักงาน,ชื่อ,นามสกุล,เบอร์โทร,แผนก,ตำแหน่ง,สิทธิ์สร้างเอกสาร',
      `E100,นำเข้า,ใจดี,${phoneFmt(emp.phone)},บัญชี,หัวหน้า,ใช่`,
      `E101,มาก่อน,ใจดี,${early.phone},ขาย,,`,
      `,ไม่มีรหัส,,0812345678,,,`,
      `E100,ซ้ำ,,0812345678,,,`,
    ].join('\n');
    const res = await post(companyAdmin.agent, `/api/companies/${companyId}/employee-imports`).attach('file', Buffer.from('﻿' + csv), 'staff.csv').expect(201);
    expect(res.body).toMatchObject({ inserted: 2, updated: 0, autoApproved: 1, createdDepartments: ['ขาย'], createdPositions: ['หัวหน้า'] });
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([4, 5]);

    const joined = (await post(emp.agent, '/api/companies/join').send({ code, employeeCode: 'E100', departmentId: deptId, positionId: posId }).expect(201)).body;
    expect(joined.status).toBe('approved');
    const me = (await emp.agent.get('/api/me')).body;
    expect(me.memberships[0].canCreateDocuments).toBe(true);
    expect((await early.agent.get('/api/me')).body.memberships[0].status).toBe('approved');
  });

  it('a suspended company keeps its data but members cannot use it (ADM-01)', async () => {
    await patch(superAdmin, `/api/admin/companies/${companyId}`).send({ status: 'suspended' }).expect(200);
    await companyAdmin.agent.get(`/api/companies/${companyId}/dashboard`).expect(403);
    await superAdmin.get(`/api/companies/${companyId}/dashboard`).expect(200);
    await patch(superAdmin, `/api/admin/companies/${companyId}`).send({ status: 'active' }).expect(200);
    await companyAdmin.agent.get(`/api/companies/${companyId}/dashboard`).expect(200);
  });
});

describe('audit log and webhook', () => {
  it('audit_logs is append-only', async () => {
    await expect(sql`UPDATE audit_logs SET action = 'x'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM audit_logs`.execute(db)).rejects.toThrow(/append-only/);
  });

  it('LINE webhook needs a valid signature and tracks follow/unfollow', async () => {
    const lineUserId = nextLineId();
    const agent = await login(lineUserId);
    const body = JSON.stringify({ destination: 'x', events: [{ type: 'unfollow', source: { type: 'user', userId: lineUserId } }] });
    await request(app.getHttpServer()).post('/api/line/webhook').set('content-type', 'application/json').set('x-line-signature', 'bad').send(body).expect(401);
    const sig = createHmac('sha256', 'test-channel-secret').update(body).digest('base64');
    await request(app.getHttpServer()).post('/api/line/webhook').set('content-type', 'application/json').set('x-line-signature', sig).send(body).expect(200);
    expect((await agent.get('/api/me')).body.isOaFriend).toBe(false);
  });
});
