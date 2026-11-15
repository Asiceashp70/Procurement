import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { ShapedFont } from '../src/documents/pdf/thai-text';
import { SearchService } from '../src/search/search.service';
import { TextService } from '../src/search/text.service';
import { startHarness, type Agent, type Harness } from './harness';
import { SUPER_ADMIN_LINE_ID } from './helpers';

const OCR_PORT = 18090 + Number(process.env.JEST_WORKER_ID ?? 1);
let ocrMode: 'ok' | 'down' = 'ok';
let ocrCalls = 0;
let ocr: Server;

let h: Harness;
let superAdmin: Agent;
let admin: { agent: Agent; id: string };
let alice: { agent: Agent; id: string };
let outsider: { agent: Agent; id: string };
let companyId: string;
let docId: string;

/** 3 pages: Thai text, an empty "scanned" page, more Thai text. */
async function thaiPdf() {
  const doc = await PDFDocument.create();
  const font = await ShapedFont.embed(doc);
  const p1 = doc.addPage([595, 842]);
  font.draw(p1, 'สัญญา จ้าง งาน ฉบับที่ 7 ระหว่างบริษัทกับพนักงาน', { x: 60, y: 760, size: 16 });
  font.draw(p1, 'ผู้ใหญ่ น้ำ ที่ ปี่ ฝ่ายผลิต', { x: 60, y: 730, size: 14 });
  doc.addPage([595, 842]); // nothing extractable -> OCR
  const p3 = doc.addPage([595, 842]);
  font.draw(p3, 'ค่าตอบแทนเดือนละ 25,000 บาท จ่ายทุกวันที่ ๒๕', { x: 60, y: 760, size: 16 });
  return Buffer.from(await doc.save());
}

async function drainJobs() {
  while ((await h.jobs.runOnce()) > 0);
}

const search = (a: Agent, params: Record<string, string>) => a.get(`/api/search?${new URLSearchParams(params)}`);

beforeAll(async () => {
  // a stand-in OCR worker that "reads" each requested page
  ocr = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      ocrCalls++;
      if (ocrMode === 'down') {
        res.writeHead(503).end('busy');
        return;
      }
      const body = Buffer.concat(chunks).toString('latin1');
      const pages = /name="pages"\r\n\r\n([^\r]*)/.exec(body)![1].split(',').map(Number);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          pages: pages.map((page) => ({
            page,
            // NIKHAHIT + SARA AA, as many OCR models and old PDFs produce it
            text: 'หนังสือรับรองการทํางาน\nออกให้ ณ วันที่ 15',
            confidence: 0.87,
            lines: [
              { text: 'หนังสือรับรองการทํางาน', confidence: 0.9, x: 0.1, y: 0.1, w: 0.6, h: 0.04 },
              { text: 'ออกให้ ณ วันที่ 15', confidence: 0.8, x: 0.1, y: 0.2, w: 0.4, h: 0.03 },
            ],
          })),
        }),
      );
    });
  });
  await new Promise<void>((r) => ocr.listen(OCR_PORT, '127.0.0.1', r));

  h = await startHarness({ OCR_WORKER_URL: `http://127.0.0.1:${OCR_PORT}` });
  superAdmin = (await h.registeredUser('ซุปเปอร์', SUPER_ADMIN_LINE_ID)).agent;
  admin = await h.registeredUser('ผู้ดูแล');
  alice = await h.registeredUser('อลิส');
  outsider = await h.registeredUser('คนนอก');
  companyId = (await h.post(superAdmin, '/api/admin/companies').send({ name: 'บริษัท ค้นหา จำกัด' }).expect(201)).body.id;
  await h.post(superAdmin, `/api/admin/companies/${companyId}/admins`).send({ userId: admin.id }).expect(201);
  for (const u of [alice, outsider]) await h.db.insertInto('memberships').values({ user_id: u.id, company_id: companyId, status: 'approved' }).execute();
});

afterAll(async () => {
  await h?.close();
  ocr?.close();
});

describe('text extraction and OCR (DOC-08, SRC-06, SRC-07)', () => {
  it('reads PDF text, sends the empty page to OCR, then marks the document ready', async () => {
    const up = await h.post(admin.agent, '/api/documents').field('companyId', companyId).field('docType', 'สัญญาจ้าง').field('tags', 'HR,2569').attach('file', await thaiPdf(), 'contract.pdf').expect(201);
    docId = up.body.id;
    expect((await h.db.selectFrom('documents').select('text_status').where('id', '=', docId).executeTakeFirstOrThrow()).text_status).toBe('pending');
    await drainJobs();

    const pages = await h.db.selectFrom('document_pages').selectAll().where('document_id', '=', docId).orderBy('page_no').execute();
    expect(pages.map((p) => p.text_source)).toEqual(['pdf', 'ocr', 'pdf']);
    expect(pages[0].text).toContain('ระหว่างบริษัทกับพนักงาน');
    expect(pages[0].text_normalized).toContain('สัญญาจ้างงาน');
    expect(pages[1].ocr_confidence).toBeCloseTo(0.87);
    expect(pages[1].text_normalized).toContain('ทำงาน'); // ํ+า recombined
    expect(pages[2].text_normalized).toContain('วันที่25'); // Thai digits
    const d = (await admin.agent.get(`/api/documents/${docId}`).expect(200)).body;
    expect(d).toMatchObject({ textStatus: 'ready', ocrPages: 1, ocrFailedPages: 0 });
  });

  it('keeps retrying while the OCR worker is down and shows the document as being read', async () => {
    ocrMode = 'down';
    const doc = await PDFDocument.create();
    doc.addPage();
    const up = await h.post(admin.agent, '/api/documents').field('companyId', companyId).attach('file', Buffer.from(await doc.save()), 'scan.pdf').expect(201);
    const before = ocrCalls;
    await drainJobs();
    expect(ocrCalls).toBe(before + 1);
    const row = await h.db.selectFrom('documents').select('text_status').where('id', '=', up.body.id).executeTakeFirstOrThrow();
    expect(row.text_status).toBe('ocr');
    const job = await h.db.selectFrom('jobs').selectAll().where('type', '=', 'document.ocr').where('status', '=', 'queued').executeTakeFirstOrThrow();
    expect(job.max_attempts).toBe(6);
    expect(job.run_at.getTime()).toBeGreaterThan(Date.now()); // backoff
    ocrMode = 'ok';
  });

  it('queues documents that were never read (backfill)', async () => {
    await h.db.updateTable('documents').set({ text_status: 'pending' }).where('id', '=', docId).execute();
    expect(await h.app.get(TextService).backfill()).toBe(1);
    expect(await h.app.get(TextService).backfill()).toBe(0); // already queued
    await drainJobs();
  });
});

describe('search (SRC-01..05, SRC-08)', () => {
  it('finds words across spaces and shows the page and snippet', async () => {
    const r = (await search(admin.agent, { q: 'สัญญาจ้าง', scope: 'mine' }).expect(200)).body;
    expect(r.items).toHaveLength(1);
    const hit = r.items[0];
    expect(hit.id).toBe(docId);
    expect(hit.matches[0]).toMatchObject({ pageNo: 1, source: 'pdf' });
    expect(hit.matches[0].snippet.match.replace(/\s/g, '')).toBe('สัญญาจ้าง');
  });

  it('finds OCR text and says it came from OCR with the confidence', async () => {
    const r = (await search(admin.agent, { q: 'การทำงาน' }).expect(200)).body;
    expect(r.items[0].matches[0]).toMatchObject({ pageNo: 2, source: 'ocr', confidence: 0.87 });
    // the query is normalized the same way: SARA AM typed either way finds it
    expect((await search(admin.agent, { q: 'การทํางาน' }).expect(200)).body.items).toHaveLength(1);
  });

  it('matches Thai digits, words with tone marks, and the title', async () => {
    expect((await search(admin.agent, { q: 'วันที่ 25' }).expect(200)).body.items[0].matches[0].pageNo).toBe(3);
    expect((await search(admin.agent, { q: 'น้ำ' }).expect(200)).body.items).toHaveLength(1);
    expect((await search(admin.agent, { q: 'ฝ่ายผลิต' }).expect(200)).body.items).toHaveLength(1);
    const byTitle = (await search(admin.agent, { q: 'contract' }).expect(200)).body.items[0];
    expect(byTitle.titleHit).toBe(true);
    await search(admin.agent, { q: 'ก' }).expect(400); // too short
    expect((await search(admin.agent, { q: '100%' }).expect(200)).body.items).toHaveLength(0); // wildcards are literal
  });

  it('only shows documents a person is involved in; admins search the company (SRC-01, SRC-02)', async () => {
    expect((await search(alice.agent, { q: 'สัญญาจ้าง' }).expect(200)).body.items).toHaveLength(0); // draft, not involved
    expect((await search(admin.agent, { q: 'สัญญาจ้าง', scope: 'company', companyId }).expect(200)).body.items).toHaveLength(0); // drafts are private

    // send it to Alice
    await h.patch(admin.agent, `/api/documents/${docId}`).send({ dueAt: new Date(Date.now() + 86400_000 * 3).toISOString() }).expect(200);
    await h.put(admin.agent, `/api/documents/${docId}/layout`).send({ signers: [{ userId: alice.id, order: 1 }], fields: [{ id: randomUUID(), signerUserId: alice.id, pageNo: 1, type: 'signature', x: 0.1, y: 0.8, w: 0.3, h: 0.08 }] }).expect(200);
    await h.post(admin.agent, `/api/documents/${docId}/send`).expect(201);

    expect((await search(alice.agent, { q: 'สัญญาจ้าง' }).expect(200)).body.items).toHaveLength(1);
    expect((await search(outsider.agent, { q: 'สัญญาจ้าง' }).expect(200)).body.items).toHaveLength(0);
    expect((await search(admin.agent, { q: 'สัญญาจ้าง', scope: 'company', companyId }).expect(200)).body.items).toHaveLength(1);
    await search(alice.agent, { q: 'สัญญาจ้าง', scope: 'company', companyId }).expect(403);
    await search(alice.agent, { q: 'สัญญาจ้าง', scope: 'all' }).expect(403);
    expect((await search(superAdmin, { q: 'สัญญาจ้าง', scope: 'all' }).expect(200)).body.items).toHaveLength(1);
  });

  it('filters by status, signer, type, tag and date, with or without words (SRC-03)', async () => {
    const base = { scope: 'company', companyId };
    expect((await search(admin.agent, { ...base, status: 'pending' }).expect(200)).body.items).toHaveLength(1);
    expect((await search(admin.agent, { ...base, status: 'completed' }).expect(200)).body.items).toHaveLength(0);
    expect((await search(admin.agent, { ...base, signerId: alice.id, q: 'สัญญา' }).expect(200)).body.items).toHaveLength(1);
    expect((await search(admin.agent, { ...base, signerId: outsider.id }).expect(200)).body.items).toHaveLength(0);
    expect((await search(admin.agent, { ...base, docType: 'สัญญาจ้าง', tag: 'HR' }).expect(200)).body.items).toHaveLength(1);
    expect((await search(admin.agent, { ...base, tag: 'ไม่มี' }).expect(200)).body.items).toHaveLength(0);
    expect((await search(admin.agent, { ...base, from: new Date(Date.now() + 3600_000).toISOString() }).expect(200)).body.items).toHaveLength(0);
    const facets = (await admin.agent.get(`/api/search/facets?scope=company&companyId=${companyId}`).expect(200)).body;
    expect(facets).toEqual({ docTypes: ['สัญญาจ้าง'], tags: ['2569', 'HR'] });
  });

  it('returns highlight boxes for the page (SRC-04) and logs admin viewing', async () => {
    const pdfHits = (await alice.agent.get(`/api/documents/${docId}/pages/1/highlights?q=${encodeURIComponent('สัญญาจ้าง')}`).expect(200)).body;
    expect(pdfHits.source).toBe('pdf');
    expect(pdfHits.boxes).toHaveLength(1);
    const b = pdfHits.boxes[0];
    expect(b.x).toBeGreaterThan(0.05);
    expect(b.y).toBeGreaterThan(0.02);
    expect(b.y).toBeLessThan(0.15); // first line near the top
    const ocrHits = (await alice.agent.get(`/api/documents/${docId}/pages/2/highlights?q=${encodeURIComponent('ทำงาน')}`).expect(200)).body;
    expect(ocrHits).toMatchObject({ source: 'ocr', confidence: 0.87 });
    expect(ocrHits.boxes[0].y).toBeCloseTo(0.1);
    await outsider.agent.get(`/api/documents/${docId}/pages/1/highlights?q=x`).expect(403);
  });

  it('search service handles an empty query as a filter-only listing', async () => {
    const svc = h.app.get(SearchService);
    const user = await h.db.selectFrom('users').selectAll().where('id', '=', admin.id).executeTakeFirstOrThrow();
    const r = await svc.search(user, { scope: 'mine' });
    expect(r.items.length).toBeGreaterThanOrEqual(2);
  });
});
