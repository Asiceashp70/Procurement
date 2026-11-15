import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { PDFDocument } from 'pdf-lib';
import { startHarness, type Agent, type Harness } from './harness';
import { makePng, SUPER_ADMIN_LINE_ID } from './helpers';
import { makeTestPki } from './pki';
import { SchedulerService } from '../src/documents/scheduler.service';

let h: Harness;
let superAdmin: Agent;
let admin: { agent: Agent; id: string };
let alice: { agent: Agent; id: string };
let bob: { agent: Agent; id: string };
let carol: { agent: Agent; id: string };
let companyId: string;
let pdf: Buffer;

async function twoPagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([842, 595]);
  return Buffer.from(await doc.save());
}

const future = (days = 3) => new Date(Date.now() + days * 86400_000).toISOString();
const notes = (userId: string, type?: string) =>
  h.db.selectFrom('notifications').selectAll().where('user_id', '=', userId).$if(Boolean(type), (q) => q.where('type', '=', type!)).execute();

/** Uploads a PDF, lays out fields, sets the due date and sends it. */
async function sendDoc(opts: { mode?: 'sequential' | 'parallel'; signers: { id: string; order: number }[]; fields?: (signerIds: Record<string, string>) => object[]; due?: string }) {
  const up = await h.post(admin.agent, '/api/documents').field('companyId', companyId).attach('file', pdf, 'test.pdf').expect(201);
  const id = up.body.id as string;
  await h.patch(admin.agent, `/api/documents/${id}`).send({ dueAt: opts.due ?? future(), signingMode: opts.mode ?? 'sequential' }).expect(200);
  const fields =
    opts.fields?.({}) ??
    opts.signers.map((s) => ({ id: randomUUID(), signerUserId: s.id, pageNo: 1, type: 'signature', x: 0.1, y: 0.1 + 0.15 * s.order, w: 0.3, h: 0.08 }));
  await h.put(admin.agent, `/api/documents/${id}/layout`).send({ signers: opts.signers.map((s) => ({ userId: s.id, order: s.order })), fields }).expect(200);
  await h.post(admin.agent, `/api/documents/${id}/send`).expect(201);
  return id;
}

/** Runs background jobs until the queue is empty (notifications, finalize). */
async function drainJobs() {
  while ((await h.jobs.runOnce()) > 0);
}

const sign = (a: Agent, id: string, payload: object, signature?: Buffer) => {
  const r = h.post(a, `/api/documents/${id}/sign`).field('payload', JSON.stringify(payload));
  return signature ? r.attach('signature', signature, 'sig.png') : r;
};

beforeAll(async () => {
  h = await startHarness();
  pdf = await twoPagePdf();
  superAdmin = (await h.registeredUser('ซุปเปอร์', SUPER_ADMIN_LINE_ID)).agent;
  admin = await h.registeredUser('ผู้ดูแล');
  alice = await h.registeredUser('อลิส');
  bob = await h.registeredUser('บ็อบ');
  carol = await h.registeredUser('แครอล');
  companyId = (await h.post(superAdmin, '/api/admin/companies').send({ name: 'บริษัท เอกสาร จำกัด' }).expect(201)).body.id;
  await h.post(superAdmin, `/api/admin/companies/${companyId}/admins`).send({ userId: admin.id }).expect(201);
  for (const u of [alice, bob, carol]) {
    await h.db.insertInto('memberships').values({ user_id: u.id, company_id: companyId, status: 'approved', employee_code: u.id.slice(0, 6) }).execute();
  }
});

afterAll(() => h?.close());

describe('upload and draft (DOC-01..08)', () => {
  it('needs the create permission and a real PDF/JPG/PNG', async () => {
    await h.post(alice.agent, '/api/documents').field('companyId', companyId).attach('file', pdf, 'a.pdf').expect(403);
    const bad = await h.post(admin.agent, '/api/documents').field('companyId', companyId).attach('file', Buffer.from('nope'), 'a.pdf').expect(400);
    expect(bad.body.message).toContain('PDF, JPG');
    // an image becomes a 1-page PDF
    const img = await h.post(admin.agent, '/api/documents').field('companyId', companyId).attach('file', makePng(600, 800), 'รูป.png').expect(201);
    const d = (await admin.agent.get(`/api/documents/${img.body.id}`).expect(200)).body;
    expect(d.pageCount).toBe(1);
    expect(d.title).toBe('รูป'); // DOC-02: defaults to the file name
  });

  it('keeps drafts private, validates the layout and refuses to send an incomplete document', async () => {
    const up = await h.post(admin.agent, '/api/documents').field('companyId', companyId).attach('file', pdf, 'สัญญาจ้าง.pdf').expect(201);
    const id = up.body.id;
    await alice.agent.get(`/api/documents/${id}`).expect(404);

    const missing = await h.post(admin.agent, `/api/documents/${id}/send`).expect(400);
    expect(missing.body.problems).toEqual(expect.arrayContaining(['ยังไม่ได้กำหนดวันครบกำหนด', 'ยังไม่ได้เลือกผู้เซ็น']));

    // a field for someone who is not a signer, or outside the page, is refused
    await h.put(admin.agent, `/api/documents/${id}/layout`).send({ signers: [{ userId: alice.id, order: 1 }], fields: [{ id: randomUUID(), signerUserId: bob.id, pageNo: 1, type: 'signature', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }] }).expect(400);
    await h.put(admin.agent, `/api/documents/${id}/layout`).send({ signers: [{ userId: alice.id, order: 1 }], fields: [{ id: randomUUID(), signerUserId: alice.id, pageNo: 3, type: 'signature', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }] }).expect(400);
    // a signer without fields cannot be sent
    await h.put(admin.agent, `/api/documents/${id}/layout`).send({ signers: [{ userId: alice.id, order: 1 }, { userId: bob.id, order: 2 }], fields: [{ id: randomUUID(), signerUserId: alice.id, pageNo: 1, type: 'signature', x: 0.1, y: 0.1, w: 0.2, h: 0.1 }] }).expect(200);
    await h.patch(admin.agent, `/api/documents/${id}`).send({ dueAt: new Date(Date.now() - 60_000).toISOString() }).expect(200);
    const problems = (await h.post(admin.agent, `/api/documents/${id}/send`).expect(400)).body.problems;
    expect(problems).toEqual(expect.arrayContaining(['วันครบกำหนดต้องเป็นอนาคต', expect.stringContaining('ยังไม่มีกรอบให้กรอก')]));
  });
});

describe('sequential signing, replacement and completion (DOC-06, DOC-10, SGN-01..09)', () => {
  let id: string;
  const f = { aSig: randomUUID(), aDate: randomUUID(), aText: randomUUID(), bSig: randomUUID(), bCheck: randomUUID(), bCopy: randomUUID() };

  it('sends to the first signer only', async () => {
    id = await sendDoc({
      signers: [
        { id: alice.id, order: 1 },
        { id: bob.id, order: 2 },
      ],
      fields: () => [
        { id: f.aSig, signerUserId: alice.id, pageNo: 1, type: 'signature', x: 0.1, y: 0.7, w: 0.3, h: 0.08 },
        { id: f.aDate, signerUserId: alice.id, pageNo: 1, type: 'date', x: 0.1, y: 0.8, w: 0.3, h: 0.04 },
        { id: f.aText, signerUserId: alice.id, pageNo: 1, type: 'text', x: 0.1, y: 0.6, w: 0.5, h: 0.05, settings: { label: 'ตำแหน่ง', maxLength: 50 } },
        { id: f.bSig, signerUserId: bob.id, pageNo: 2, type: 'signature', x: 0.6, y: 0.7, w: 0.3, h: 0.1 },
        { id: f.bCheck, signerUserId: bob.id, pageNo: 2, type: 'checkbox', x: 0.6, y: 0.6, w: 0.04, h: 0.05, settings: { required: true, label: 'รับทราบ' } },
        { id: f.bCopy, signerUserId: bob.id, pageNo: 1, type: 'certified_copy', x: 0.6, y: 0.05, w: 0.3, h: 0.15 },
      ],
    });
    expect(await notes(alice.id, 'doc.sign_request')).toHaveLength(1);
    expect(await notes(bob.id, 'doc.sign_request')).toHaveLength(0);
    // after sending, the layout is frozen (DOC-08)
    await h.put(admin.agent, `/api/documents/${id}/layout`).send({ signers: [], fields: [] }).expect(409);
  });

  it('refuses and logs a signature out of turn (SGN-05)', async () => {
    const ctx = (await bob.agent.get(`/api/documents/${id}/signing`).expect(200)).body;
    expect(ctx.canSign).toBe(false);
    expect(ctx.waitingFor).toEqual(['อลิส ทดสอบ']);
    await sign(bob.agent, id, { values: { [f.bCheck]: true }, useSavedSignature: true, consent: true }).expect(403);
    await carol.agent.get(`/api/documents/${id}`).expect(403); // not involved
    const denied = await h.db.selectFrom('document_events').selectAll().where('document_id', '=', id).where('type', '=', 'sign_denied').execute();
    expect(denied.length).toBeGreaterThanOrEqual(1);
  });

  it('shows only my fields with settings, others as outlines (SGN-01)', async () => {
    const ctx = (await alice.agent.get(`/api/documents/${id}/signing`).expect(200)).body;
    expect(ctx.canSign).toBe(true);
    const mine = ctx.fields.filter((x: { mine: boolean }) => x.mine);
    expect(mine).toHaveLength(3);
    expect(ctx.fields.find((x: { id: string }) => x.id === f.bCheck).settings).toEqual({});
    const signer = await h.db.selectFrom('document_signers').select('opened_at').where('user_id', '=', alice.id).where('document_id', '=', id).executeTakeFirstOrThrow();
    expect(signer.opened_at).not.toBeNull();
  });

  it('requires consent and the required fields, then signs and wakes the next signer (SGN-02, SGN-03, SGN-10)', async () => {
    await sign(alice.agent, id, { values: { [f.aText]: 'ผู้จัดการ' }, useSavedSignature: true, consent: false }).expect(400);
    const miss = await sign(alice.agent, id, { values: {}, useSavedSignature: true, consent: true }).expect(400);
    expect(miss.body).toMatchObject({ code: 'FIELDS_MISSING', missing: [f.aText] });
    await sign(alice.agent, id, { values: { [f.aText]: 'x'.repeat(51) }, useSavedSignature: true, consent: true }).expect(400);
    await sign(alice.agent, id, { values: { [f.aText]: 'ผู้จัดการฝ่ายผลิต' }, useSavedSignature: true, consent: true }).expect(201);
    // signing twice is not possible
    await sign(alice.agent, id, { values: { [f.aText]: 'อีกครั้ง' }, useSavedSignature: true, consent: true }).expect(403);

    expect(await notes(admin.id, 'doc.signed')).toHaveLength(1);
    expect(await notes(bob.id, 'doc.sign_request')).toHaveLength(1);
    const ev = await h.db.selectFrom('document_events').selectAll().where('document_id', '=', id).where('type', '=', 'signed').executeTakeFirstOrThrow();
    expect(ev.actor_line_user_id).toMatch(/^U/);
    expect(ev.ip).toBeTruthy();
  });

  it('limits manual reminders to once an hour per person', async () => {
    const r1 = (await h.post(admin.agent, `/api/documents/${id}/remind`).send({}).expect(201)).body;
    expect(r1.sent).toHaveLength(1);
    const r2 = (await h.post(admin.agent, `/api/documents/${id}/remind`).send({}).expect(201)).body;
    expect(r2.sent).toHaveLength(0);
    expect(r2.skipped).toHaveLength(1);
    await h.post(alice.agent, `/api/documents/${id}/remind`).send({}).expect(403); // signers cannot remind
  });

  it('admin replaces Bob with Carol; Bob loses access and Carol gets his fields (DOC-10)', async () => {
    const detail = (await admin.agent.get(`/api/documents/${id}`).expect(200)).body;
    const bobRow = detail.signers.find((s: { userId: string }) => s.userId === bob.id);
    await h.post(admin.agent, `/api/documents/${id}/signers/${bobRow.id}/replace`).send({ userId: alice.id, reason: 'x' }).expect(409); // already a signer
    await h.post(admin.agent, `/api/documents/${id}/signers/${bobRow.id}/replace`).send({ userId: carol.id, reason: 'บ็อบลาพักร้อน' }).expect(201);

    await bob.agent.get(`/api/documents/${id}/signing`).expect(403);
    expect(await notes(bob.id, 'doc.signer_removed')).toHaveLength(1);
    expect(await notes(carol.id, 'doc.sign_request')).toHaveLength(1);
    const ctx = (await carol.agent.get(`/api/documents/${id}/signing`).expect(200)).body;
    expect(ctx.canSign).toBe(true);
    expect(ctx.fields.filter((x: { mine: boolean }) => x.mine).map((x: { id: string }) => x.id).sort()).toEqual([f.bSig, f.bCheck, f.bCopy].sort());
  });

  it('the last signature completes the document; the final PDF has the certificate page (SGN-07, SGN-09)', async () => {
    // one-time signature drawn just for this document
    await sign(carol.agent, id, { values: { [f.bCheck]: true }, useSavedSignature: false, consent: true }).expect(400);
    const done = await sign(carol.agent, id, { values: { [f.bCheck]: true }, useSavedSignature: false, consent: true }, makePng(400, 140)).expect(201);
    expect(done.body.completed).toBe(true);

    let d = (await admin.agent.get(`/api/documents/${id}`).expect(200)).body;
    expect(d.status).toBe('completed');
    expect(d.finalReady).toBe(false);
    await drainJobs();
    d = (await admin.agent.get(`/api/documents/${id}`).expect(200)).body;
    expect(d.finalReady).toBe(true);
    expect(d.sealStatus).toBe('no_certificate');
    expect(d.finalSha256).toMatch(/^[0-9a-f]{64}$/);

    const final = await alice.agent.get(`/api/documents/${id}/file?v=final&download=1`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(final.headers['content-disposition']).toContain('attachment');
    const finalDoc = await PDFDocument.load(final.body);
    expect(finalDoc.getPageCount()).toBe(3); // 2 + certificate page

    // everyone involved gets the link; admins hear that it was not sealed
    for (const u of [admin, alice, carol]) expect(await notes(u.id, 'doc.completed')).toHaveLength(1);
    expect(await notes(bob.id, 'doc.completed')).toHaveLength(0);
    expect((await notes(admin.id, 'cert.missing')).length).toBeGreaterThanOrEqual(1);

    // SGN-08: the system recognises its own final file and spots a 1-byte change
    const ok = (await h.post(alice.agent, '/api/verify').attach('file', final.body, 'f.pdf').expect(201)).body;
    expect(ok).toMatchObject({ match: 'final', document: { id } });
    const changed = Buffer.from(final.body);
    changed[100] ^= 1;
    expect((await h.post(alice.agent, '/api/verify').attach('file', changed, 'f.pdf').expect(201)).body.match).toBe('none');
    expect((await h.post(alice.agent, '/api/verify').attach('file', pdf, 'f.pdf').expect(201)).body.match).toBe('original');
  });

  it('document_events is append-only', async () => {
    await expect(sql`UPDATE document_events SET type = 'x'`.execute(h.db)).rejects.toThrow(/append-only/);
  });
});

describe('decline and void (SGN-04)', () => {
  it('a decline stops the document and tells the creator', async () => {
    const id = await sendDoc({ signers: [{ id: alice.id, order: 1 }] });
    await h.post(alice.agent, `/api/documents/${id}/decline`).send({ reason: '' }).expect(400);
    await h.post(alice.agent, `/api/documents/${id}/decline`).send({ reason: 'ตัวเลขในสัญญาไม่ถูกต้อง' }).expect(201);
    const d = (await admin.agent.get(`/api/documents/${id}`).expect(200)).body;
    expect(d.status).toBe('declined');
    const n = (await notes(admin.id, 'doc.declined')).find((x) => (x.payload as { documentId: string }).documentId === id);
    expect((n!.payload as { reason: string }).reason).toBe('ตัวเลขในสัญญาไม่ถูกต้อง');
  });

  it('void tells unsigned signers and blocks signing', async () => {
    const id = await sendDoc({ mode: 'parallel', signers: [{ id: alice.id, order: 1 }, { id: carol.id, order: 1 }] });
    await h.post(admin.agent, `/api/documents/${id}/void`).send({ reason: 'ส่งผิดฉบับ' }).expect(201);
    expect((await notes(carol.id, 'doc.voided')).length).toBeGreaterThanOrEqual(1);
    await sign(alice.agent, id, { values: {}, useSavedSignature: true, consent: true }).expect(403);
  });
});

describe('certificate seal and stamps (ADM-10, ADM-11, SGN-11)', () => {
  let pki: ReturnType<typeof makeTestPki>;
  beforeAll(() => {
    pki = makeTestPki();
  });

  it('Super Admin uploads the company certificate; wrong passwords are refused', async () => {
    await h.post(superAdmin, `/api/admin/companies/${companyId}/certificates`).field('password', 'wrong').attach('file', pki.p12, 'co.p12').expect(400);
    await h.post(admin.agent, `/api/admin/companies/${companyId}/certificates`).field('password', pki.password).attach('file', pki.p12, 'co.p12').expect(403);
    const r = await h.post(superAdmin, `/api/admin/companies/${companyId}/certificates`).field('password', pki.password).attach('file', pki.p12, 'co.p12').expect(201);
    expect(r.body.subject).toContain('Test Company');
    const dash = (await admin.agent.get(`/api/companies/${companyId}/dashboard`).expect(200)).body;
    expect(dash.certificate.subject).toContain('Test Company');
  });

  it('stamps only for permitted people; parallel signing is sealed with PAdES', async () => {
    const stamp = await h.post(admin.agent, `/api/companies/${companyId}/stamps`).field('name', 'ตราบริษัท').field('userIds', JSON.stringify([alice.id])).attach('file', makePng(200, 200), 's.png').expect(201);
    const stampId = stamp.body.id;
    expect((await alice.agent.get(`/api/companies/${companyId}/stamps`).expect(200)).body).toHaveLength(1);
    expect((await carol.agent.get(`/api/companies/${companyId}/stamps`).expect(200)).body).toHaveLength(0);
    await carol.agent.get(`/api/companies/${companyId}/stamps/${stampId}/image`).expect(403);

    // a stamp field for someone without permission cannot be sent
    const up = await h.post(admin.agent, '/api/documents').field('companyId', companyId).attach('file', pdf, 'x.pdf').expect(201);
    await h.patch(admin.agent, `/api/documents/${up.body.id}`).send({ dueAt: future() }).expect(200);
    await h.put(admin.agent, `/api/documents/${up.body.id}/layout`).send({ signers: [{ userId: carol.id, order: 1 }], fields: [{ id: randomUUID(), signerUserId: carol.id, pageNo: 1, type: 'stamp', x: 0.1, y: 0.1, w: 0.2, h: 0.2, settings: { stampId } }] }).expect(200);
    const refused = await h.post(admin.agent, `/api/documents/${up.body.id}/send`).expect(400);
    expect(refused.body.problems[0]).toContain('ไม่มีสิทธิ์ใช้ตรา');

    const stampField = randomUUID();
    const id = await sendDoc({
      mode: 'parallel',
      signers: [
        { id: alice.id, order: 1 },
        { id: carol.id, order: 1 },
      ],
      fields: () => [
        { id: randomUUID(), signerUserId: alice.id, pageNo: 1, type: 'signature', x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
        { id: stampField, signerUserId: alice.id, pageNo: 1, type: 'stamp', x: 0.5, y: 0.1, w: 0.2, h: 0.2, settings: { stampId } },
        { id: randomUUID(), signerUserId: carol.id, pageNo: 2, type: 'signature', x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
      ],
    });
    // parallel: both are notified at once
    expect((await h.db.selectFrom('document_signers').select('status').where('document_id', '=', id).execute()).map((s) => s.status)).toEqual(['pending', 'pending']);
    await sign(alice.agent, id, { values: {}, useSavedSignature: true, consent: true }).expect(400); // stamp is required
    await sign(alice.agent, id, { values: { [stampField]: true }, useSavedSignature: true, consent: true }).expect(201);
    await sign(carol.agent, id, { values: {}, useSavedSignature: true, consent: true }).expect(201);
    await drainJobs();

    const d = (await alice.agent.get(`/api/documents/${id}`).expect(200)).body;
    expect(d.sealStatus).toBe('sealed');
    const used = await h.db.selectFrom('audit_logs').selectAll().where('action', '=', 'stamp.used').execute();
    expect(used).toHaveLength(1);

    const res = await alice.agent.get(`/api/documents/${id}/file?v=final`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const file = join(tmpdir(), `sealed-${id}.pdf`);
    writeFileSync(file, res.body);
    const report = execFileSync('pdfsig', [file], { encoding: 'utf8' });
    expect(report).toContain('Signature is Valid.');
  });
});

describe('scheduled notifications', () => {
  it('due-soon once, overdue every 24h at most 3 times, certificate expiry', async () => {
    const id = await sendDoc({ signers: [{ id: carol.id, order: 1 }], due: new Date(Date.now() + 10 * 3600_000).toISOString() });
    const scheduler = h.app.get(SchedulerService);
    const before = (await notes(carol.id, 'doc.due_soon')).length;
    await scheduler.runOnce(new Date());
    await scheduler.runOnce(new Date());
    expect((await notes(carol.id, 'doc.due_soon')).length).toBe(before + 1);

    await h.db.updateTable('documents').set({ due_at: new Date(Date.now() - 3600_000) }).where('id', '=', id).execute();
    const overdueFor = async () => (await notes(carol.id, 'doc.overdue')).filter((n) => (n.payload as { documentId: string }).documentId === id).length;
    let t = Date.now();
    for (let i = 0; i < 5; i++) {
      await scheduler.runOnce(new Date(t));
      await scheduler.runOnce(new Date(t + 3600_000)); // an hour later: nothing new
      t += 25 * 3600_000;
    }
    expect(await overdueFor()).toBe(3);
    // automatic messages respect 21:00-08:00 Bangkok
    const n = (await notes(carol.id, 'doc.overdue'))[0];
    const hour = (n.scheduled_at.getUTCHours() + 7) % 24;
    expect(hour >= 8 && hour < 21).toBe(true);

    // the test certificate expires in 20 days -> one 30-day notice to the admins
    const r = await scheduler.runOnce(new Date());
    expect(r.certificates).toBeGreaterThanOrEqual(0);
    expect((await notes(admin.id, 'cert.expiring')).length).toBe(1);
  });

  it('suspending a signer warns the creator (ADM-04)', async () => {
    await sendDoc({ signers: [{ id: alice.id, order: 1 }] });
    const m = await h.db.selectFrom('memberships').select('id').where('user_id', '=', alice.id).where('company_id', '=', companyId).executeTakeFirstOrThrow();
    await h.patch(admin.agent, `/api/memberships/${m.id}`).send({ status: 'suspended' }).expect(200);
    expect((await notes(admin.id, 'signer.suspended')).length).toBeGreaterThanOrEqual(1);
  });

  it('dashboard counts documents (ADM-08)', async () => {
    const dash = (await admin.agent.get(`/api/companies/${companyId}/dashboard`).expect(200)).body;
    expect(dash.documents.completed).toBeGreaterThanOrEqual(2);
    expect(dash.documents.overdue).toBeGreaterThanOrEqual(1);
  });
});
