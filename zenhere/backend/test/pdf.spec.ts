import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import forge from 'node-forge';
import { displayToPdf, placeField } from '../src/documents/pdf/geometry';
import { prepareSource, UploadRejected } from '../src/documents/pdf/inspect';
import { formatThaiDate, renderFinalPdf, type RenderField } from '../src/documents/pdf/render';
import { CertificateError, readP12, sealPdf } from '../src/documents/pdf/seal';
import { makePng } from './helpers';
import { makeTestPki } from './pki';

/** 4 pages: /Rotate 0, 90, 180, 270, the last with a crop box offset from the origin. */
async function sourcePdf() {
  const doc = await PDFDocument.create();
  for (const rot of [0, 90, 180, 270]) {
    const p = doc.addPage([400, 600]);
    p.drawRectangle({ x: 0, y: 0, width: 400, height: 600, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 2 });
    p.setRotation(degrees(rot));
    if (rot === 270) p.setCropBox(50, 100, 300, 400);
  }
  // a page whose content stream leaves the CTM scaled (some producers do this)
  return Buffer.from(await doc.save());
}

let pki: ReturnType<typeof makeTestPki>;
beforeAll(() => {
  pki = makeTestPki();
});

describe('geometry', () => {
  const box = { x0: 0, y0: 0, x1: 400, y1: 600, rotation: 0 };
  it('maps the visual top-left corner for every rotation', () => {
    // display top-left (0,0) is a different PDF corner per rotation
    expect(displayToPdf({ ...box, rotation: 0 }, 0, 0)).toEqual({ x: 0, y: 600 });
    expect(displayToPdf({ ...box, rotation: 90 }, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(displayToPdf({ ...box, rotation: 180 }, 0, 0)).toEqual({ x: 400, y: 0 });
    expect(displayToPdf({ ...box, rotation: 270 }, 0, 0)).toEqual({ x: 400, y: 600 });
  });
  it('places a box in display units and rotates with the page', () => {
    const p = placeField({ ...box, rotation: 90 }, { x: 0.5, y: 0.5, w: 0.25, h: 0.1 });
    // displayed page is 600 x 400
    expect(p.width).toBeCloseTo(150);
    expect(p.height).toBeCloseTo(40);
    expect(p.angle).toBe(90);
  });
});

describe('upload checks (DOC-01)', () => {
  it('converts images to a PDF page and rejects other files', async () => {
    const r = await prepareSource(makePng(800, 400));
    expect(r.kind).toBe('png');
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].x1 - r.pages[0].x0).toBeGreaterThan(r.pages[0].y1 - r.pages[0].y0); // landscape A4
    await expect(prepareSource(Buffer.from('hello'))).rejects.toThrow(UploadRejected);
    await expect(prepareSource(Buffer.from('%PDF-1.7 garbage'))).rejects.toThrow(/เปิดไฟล์ PDF ไม่ได้/);
  });

  it('rejects password-protected PDFs', async () => {
    // a PDF whose trailer has /Encrypt, as every password-protected PDF does
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 4, R: 4 }));
    const locked = Buffer.from(await doc.save());
    await expect(prepareSource(locked)).rejects.toThrow(/รหัสผ่าน/);
  });
});

describe('final PDF and seal (SGN-07, SGN-11)', () => {
  it('formats Thai dates', () => {
    const d = new Date('2026-11-15T03:00:00Z');
    expect(formatThaiDate(d)).toBe('15 พ.ย. 2569');
    expect(formatThaiDate(d, 'long')).toBe('15 พฤศจิกายน 2569');
    expect(formatThaiDate(d, 'numeric')).toBe('15/11/2569');
  });

  it('reads the .p12 and refuses a wrong password', () => {
    const m = readP12(pki.p12, pki.password);
    expect(m.subject).toContain('Test Company Co., Ltd.');
    expect(m.chainDer).toHaveLength(1);
    expect(() => readP12(pki.p12, 'wrong')).toThrow(CertificateError);
  });

  let tsa: Server;
  let tsaUrl: string;
  beforeAll(async () => {
    // a real RFC 3161 responder backed by `openssl ts -reply`
    tsa = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        writeFileSync(join(pki.dir, 'req.tsq'), Buffer.concat(chunks));
        execFileSync('openssl', ['ts', '-reply', '-config', 'tsa.cnf', '-queryfile', 'req.tsq', '-out', 'resp.tsr'], { cwd: pki.dir, stdio: 'pipe' });
        res.writeHead(200, { 'content-type': 'application/timestamp-reply' });
        res.end(readFileSync(join(pki.dir, 'resp.tsr')));
      });
    });
    await new Promise<void>((r) => tsa.listen(0, '127.0.0.1', r));
    const addr = tsa.address() as { port: number };
    tsaUrl = `http://127.0.0.1:${addr.port}/tsr`;
  });
  afterAll(() => tsa?.close());

  it('stamps fields on rotated pages, adds the certificate page, seals and timestamps', async () => {
    const source = await sourcePdf();
    const fields: RenderField[] = [];
    for (let page = 1; page <= 4; page++) {
      fields.push({ pageNo: page, type: 'signature', x: 0.05, y: 0.05, w: 0.4, h: 0.12, settings: {}, value: null, signerId: 's1' });
      fields.push({ pageNo: page, type: 'date', x: 0.05, y: 0.2, w: 0.4, h: 0.05, settings: {}, value: null, signerId: 's1' });
      fields.push({ pageNo: page, type: 'text', x: 0.05, y: 0.3, w: 0.6, h: 0.1, settings: { fontSize: 14 }, value: 'ที่อยู่ ปี่ น้ำ ผู้ใหญ่ สัญญาจ้างเลขที่ 42', signerId: 's1' });
      fields.push({ pageNo: page, type: 'checkbox', x: 0.05, y: 0.45, w: 0.06, h: 0.04, settings: {}, value: true, signerId: 's1' });
      fields.push({ pageNo: page, type: 'certified_copy', x: 0.55, y: 0.75, w: 0.4, h: 0.2, settings: {}, value: null, signerId: 's1' });
    }
    const doc = await renderFinalPdf({
      source,
      fields,
      signatures: new Map([['s1', makePng(300, 100)]]),
      stamps: new Map(),
      signedAt: new Map([['s1', new Date('2026-11-15T03:00:00Z')]]),
      certificate: {
        documentId: '00000000-0000-0000-0000-000000000001',
        title: 'สัญญาจ้างงานพนักงานประจำ ฝ่ายผลิต ประจำปี 2569 (ฉบับทดสอบที่มีชื่อยาวมากเพื่อทดสอบการตัดบรรทัด)',
        companyName: 'บริษัท ทดสอบ จำกัด',
        creatorName: 'สมชาย ใจดี',
        sentAt: new Date('2026-11-14T03:00:00Z'),
        completedAt: new Date('2026-11-15T03:00:00Z'),
        pageCount: 4,
        signingMode: 'sequential',
        originalSha256: createHash('sha256').update(source).digest('hex'),
        signers: [
          { order: 1, name: 'สมศรี ขยันดี', position: 'หัวหน้าแผนก', department: 'ฝ่ายผลิต', signedAt: new Date('2026-11-15T02:00:00Z'), ip: '203.0.113.7', lineUserId: 'U' + 'a'.repeat(32) },
          { order: 2, name: 'ประยุทธ์ มั่นคง', position: null, department: null, signedAt: new Date('2026-11-15T03:00:00Z'), ip: '203.0.113.8', lineUserId: 'U' + 'b'.repeat(32) },
        ],
        replacements: [{ at: new Date('2026-11-14T05:00:00Z'), from: 'คนเดิม', to: 'ประยุทธ์ มั่นคง', by: 'ผู้ดูแล', reason: 'ลาออก' }],
        verifyUrl: 'https://zenhere.example.co.th/verify',
        sealedBy: 'Test Company Co., Ltd.',
      },
    });
    expect(doc.getPageCount()).toBe(5);

    const material = readP12(pki.p12, pki.password);
    const { pdf, timestamped } = await sealPdf(doc, material, { name: 'Test Company', reason: 'ปิดเอกสาร', location: 'TH', tsaUrl, signingTime: new Date() });
    expect(timestamped).toBe(true);
    const out = join(pki.dir, 'final.pdf');
    writeFileSync(out, pdf);
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);

    // poppler validates the CMS signature and the byte range
    const report = execFileSync('pdfsig', [out], { encoding: 'utf8' });
    expect(report).toContain('Signature Validation: Signature is Valid.');
    expect(report).toContain('ETSI.CAdES.detached');
    expect(report).toContain('Total document signed');

    // one changed byte after sealing is detected
    const tampered = Buffer.from(pdf);
    const at = tampered.indexOf('/Producer');
    tampered[at + 12] = tampered[at + 12] === 0x41 ? 0x42 : 0x41;
    writeFileSync(join(pki.dir, 'tampered.pdf'), tampered);
    const bad = execFileSync('pdfsig', [join(pki.dir, 'tampered.pdf')], { encoding: 'utf8' });
    expect(bad).not.toContain('Signature is Valid.');

    // the signature carries a TSA token that openssl accepts for this signature value
    const hex = /\/Contents\s*<([0-9a-fA-F]+)>/.exec(pdf.toString('latin1'))![1];
    const cms = forge.asn1.fromDer(forge.util.hexToBytes(hex.replace(/(00)+$/, '')));
    const signedData = ((cms.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
    const signerInfo = ((signedData[4].value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[]);
    const sigValue = Buffer.from(signerInfo[5].value as string, 'binary');
    const unsigned = signerInfo[6].value as forge.asn1.Asn1[];
    const token = ((unsigned[0].value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0];
    writeFileSync(join(pki.dir, 'token.der'), Buffer.from(forge.asn1.toDer(token).getBytes(), 'binary'));
    const digest = createHash('sha256').update(sigValue).digest('hex');
    const verify = execFileSync('openssl', ['ts', '-verify', '-digest', digest, '-in', 'token.der', '-token_in', '-CAfile', 'ca.crt', '-untrusted', 'tsa.crt'], { cwd: pki.dir, encoding: 'utf8' });
    expect(verify).toContain('Verification: OK');
  });
});
