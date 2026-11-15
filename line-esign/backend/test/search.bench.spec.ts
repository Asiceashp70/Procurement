/**
 * SRC-09: search over 100,000 pages answers within 1 second.
 * Run with: SEARCH_BENCH=1 npx jest test/search.bench.spec.ts
 * Builds a separate database (esign_bench_N) of 2,000 documents x 50 pages of
 * random Thai text (~400 characters a page), then times SearchService queries.
 */
import { sql } from 'kysely';
import { startHarness, type Harness } from './harness';
import { SearchService } from '../src/search/search.service';

const RUN = process.env.SEARCH_BENCH === '1';
const DOCS = Number(process.env.BENCH_DOCS ?? 2000);
const PAGES = Number(process.env.BENCH_PAGES ?? 50);

const WORDS = [
  'สัญญา', 'จ้าง', 'พนักงาน', 'บริษัท', 'ค่าจ้าง', 'เดือน', 'ตำแหน่ง', 'ฝ่าย', 'ผลิต', 'บัญชี', 'การเงิน', 'ลูกค้า', 'สินค้า', 'ราคา',
  'ใบเสนอราคา', 'ใบสั่งซื้อ', 'ส่งมอบ', 'ภายใน', 'วันที่', 'ระยะเวลา', 'เงื่อนไข', 'ข้อตกลง', 'ทั้งสองฝ่าย', 'ลงนาม', 'ผู้รับจ้าง', 'ผู้ว่าจ้าง',
  'ประกันสังคม', 'วันหยุด', 'ลาป่วย', 'ลากิจ', 'โบนัส', 'สวัสดิการ', 'การรักษา', 'ความลับ', 'ทรัพย์สิน', 'ทางปัญญา', 'ยกเลิก', 'บอกกล่าว',
  'ล่วงหน้า', 'ไม่น้อยกว่า', 'สามสิบ', 'วัน', 'ปี', 'บาท', 'ถ้วน', 'ภาษี', 'มูลค่าเพิ่ม', 'หัก', 'ณ', 'ที่จ่าย', 'ใบกำกับภาษี', 'ใบเสร็จ',
];

(RUN ? describe : describe.skip)('search speed over 100,000 pages (SRC-09)', () => {
  let h: Harness;
  let svc: SearchService;
  let superAdmin: Awaited<ReturnType<Harness['db']['selectFrom']>> extends never ? never : any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    h = await startHarness();
    svc = h.app.get(SearchService);
    const t0 = Date.now();
    const u = await h.db.insertInto('users').values({ line_user_id: 'U' + 'f'.repeat(32), is_super_admin: true, registered_at: new Date(), first_name: 'Bench' }).returningAll().executeTakeFirstOrThrow();
    superAdmin = u;
    const c = await h.db.insertInto('companies').values({ name: 'Bench Co', invite_code: '99999999', invite_token: 'bench-token', settings: '{}' }).returning('id').executeTakeFirstOrThrow();
    await h.db.insertInto('memberships').values({ user_id: u.id, company_id: c.id, role: 'admin', status: 'approved' }).execute();
    await sql`
      INSERT INTO documents (company_id, created_by, title, title_normalized, status, original_name, original_mime, original_key, source_key,
                             original_sha256, source_sha256, page_count, byte_size, sent_at, text_status)
      SELECT ${c.id}, ${u.id}, 'เอกสารทดสอบ ' || g, 'เอกสารทดสอบ' || g, 'completed', 'x.pdf', 'application/pdf', 'k', 'k',
             md5(g::text), md5(g::text), ${PAGES}, 1, now(), 'ready'
      FROM generate_series(1, ${DOCS}) g`.execute(h.db);
    // random Thai text; the correlated WHERE makes Postgres draw new words for every page
    await sql`
      INSERT INTO document_pages (document_id, page_no, width, height, text, text_normalized, text_source)
      SELECT d.id, p, 595, 842, t.txt, replace(t.txt, ' ', ''), 'pdf'
      FROM documents d
      CROSS JOIN generate_series(1, ${PAGES}) p
      CROSS JOIN LATERAL (
        SELECT string_agg((${WORDS}::text[])[1 + floor(random() * ${WORDS.length})::int], ' ') AS txt
        FROM generate_series(1, 80) w WHERE p > 0 AND d.id IS NOT NULL
      ) t`.execute(h.db);
    // a rare phrase on 3 pages to look for
    await sql`UPDATE document_pages SET text = text || ' ฟักทองอบเนยสด', text_normalized = text_normalized || 'ฟักทองอบเนยสด'
              WHERE (document_id, page_no) IN (SELECT document_id, page_no FROM document_pages ORDER BY random() LIMIT 3)`.execute(h.db);
    await sql`ANALYZE documents`.execute(h.db);
    await sql`ANALYZE document_pages`.execute(h.db);
    const n = await sql<{ n: number }>`SELECT count(*)::int AS n FROM document_pages`.execute(h.db);
    // eslint-disable-next-line no-console
    console.log(`built ${n.rows[0].n} pages in ${Date.now() - t0} ms`);
  }, 30 * 60_000);

  afterAll(() => h?.close());

  const timed = async (label: string, q: Parameters<SearchService['search']>[1]) => {
    await svc.search(superAdmin, q); // warm the cache once, as a running server would be
    const runs: number[] = [];
    let r: Awaited<ReturnType<SearchService['search']>> | null = null;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      r = await svc.search(superAdmin, q);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(`${label}: median ${runs[2].toFixed(0)} ms, worst ${runs[4].toFixed(0)} ms, ${r!.items.length} documents on page 1`);
    return { median: runs[2], worst: runs[4], r: r! };
  };

  it('a rare phrase', async () => {
    const { worst, r } = await timed('rare phrase "ฟักทองอบเนย"', { q: 'ฟักทองอบเนย', scope: 'all' });
    expect(r.items.length).toBeGreaterThanOrEqual(1);
    expect(r.items.length).toBeLessThanOrEqual(3);
    expect(worst).toBeLessThan(1000);
  });

  it('a common word', async () => {
    const { worst, r } = await timed('common word "ประกันสังคม"', { q: 'ประกันสังคม', scope: 'all' });
    expect(r.items).toHaveLength(20);
    expect(worst).toBeLessThan(1000);
  });

  it('two words written with a space', async () => {
    const { worst } = await timed('"ใบกำกับ ภาษี" (spaces ignored)', { q: 'ใบกำกับ ภาษี', scope: 'all' });
    expect(worst).toBeLessThan(1000);
  });

  it('a word that is not there', async () => {
    const { worst, r } = await timed('missing word "มะพร้าวน้ำหอม"', { q: 'มะพร้าวน้ำหอม', scope: 'all' });
    expect(r.items).toHaveLength(0);
    expect(worst).toBeLessThan(1000);
  });
});
