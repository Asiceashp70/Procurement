import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { normalizeRotation, type PageBox } from './geometry';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 200;

export class UploadRejected extends Error {}

export type UploadKind = 'pdf' | 'png' | 'jpg';

export function detectKind(buf: Buffer): UploadKind | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

export function pageBoxes(doc: PDFDocument): PageBox[] {
  return doc.getPages().map((p) => {
    const c = p.getCropBox();
    return { x0: c.x, y0: c.y, x1: c.x + c.width, y1: c.y + c.height, rotation: normalizeRotation(p.getRotation().angle) };
  });
}

/**
 * DOC-01: accepts PDF/JPG/PNG up to 50 MB or 200 pages. Images become a one-page
 * A4 PDF. Password-protected or damaged PDFs are refused with the reason.
 */
export async function prepareSource(buf: Buffer): Promise<{ kind: UploadKind; pdf: Buffer; pages: PageBox[] }> {
  if (buf.length > MAX_UPLOAD_BYTES) throw new UploadRejected('ไฟล์ใหญ่เกิน 50 MB');
  const kind = detectKind(buf);
  if (!kind) throw new UploadRejected('รองรับเฉพาะไฟล์ PDF, JPG และ PNG');

  if (kind === 'pdf') {
    let doc: PDFDocument;
    let pages: PageBox[];
    try {
      doc = await PDFDocument.load(buf, { updateMetadata: false });
      pages = pageBoxes(doc);
    } catch (err) {
      // pdf-lib's EncryptedPDFError fails instanceof (ES5 Error subclass), so match the message too
      if (err instanceof EncryptedPDFError || /is encrypted/i.test(String((err as Error)?.message))) throw new UploadRejected('PDF ติดรหัสผ่าน กรุณาปลดรหัสก่อนอัปโหลด');
      throw new UploadRejected('เปิดไฟล์ PDF ไม่ได้ ไฟล์อาจเสีย');
    }
    if (doc.isEncrypted) throw new UploadRejected('PDF ติดรหัสผ่าน กรุณาปลดรหัสก่อนอัปโหลด');
    const count = pages.length;
    if (count === 0) throw new UploadRejected('PDF ไม่มีหน้า');
    if (count > MAX_PAGES) throw new UploadRejected(`เอกสารมี ${count} หน้า เกินกำหนด ${MAX_PAGES} หน้า`);
    // the signed copy is built from the original bytes, untouched
    return { kind, pdf: buf, pages };
  }

  const doc = await PDFDocument.create();
  let image;
  try {
    image = kind === 'png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
  } catch {
    throw new UploadRejected('เปิดไฟล์รูปไม่ได้ ไฟล์อาจเสีย');
  }
  const landscape = image.width > image.height;
  const [pw, ph] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const margin = 18;
  const s = Math.min((pw - 2 * margin) / image.width, (ph - 2 * margin) / image.height);
  const page = doc.addPage([pw, ph]);
  const w = image.width * s;
  const h = image.height * s;
  page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  doc.setTitle('');
  const pdf = Buffer.from(await doc.save());
  return { kind, pdf, pages: pageBoxes(doc) };
}
