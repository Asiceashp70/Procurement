import { degrees, PDFArray, PDFDocument, PDFImage, PDFName, PDFPage, PDFRef, rgb } from 'pdf-lib';
import { bangkokParts, thaiDateTime } from '../../common/thai-time';
import type { FieldSettings, FieldType } from '../../db/types';
import { pageBoxes } from './inspect';
import { placeField, type Placement } from './geometry';
import { ShapedFont } from './thai-text';

export interface RenderField {
  pageNo: number;
  type: FieldType;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: FieldSettings;
  value: unknown;
  signerId: string;
}

export interface CertificateSigner {
  order: number;
  name: string;
  position: string | null;
  department: string | null;
  signedAt: Date | null;
  ip: string | null;
  lineUserId: string;
}

export interface CertificateData {
  documentId: string;
  title: string;
  companyName: string;
  creatorName: string;
  sentAt: Date | null;
  completedAt: Date;
  pageCount: number;
  signingMode: 'parallel' | 'sequential';
  originalSha256: string;
  signers: CertificateSigner[];
  replacements: { at: Date; from: string; to: string; by: string; reason: string }[];
  verifyUrl: string;
  sealedBy: string | null;
}

export interface RenderInput {
  source: Buffer;
  fields: RenderField[];
  signatures: Map<string, Buffer>; // signerId -> PNG
  stamps: Map<string, Buffer>; // stampId -> PNG
  signedAt: Map<string, Date>; // signerId -> time
  certificate: CertificateData;
}

const TH_MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "15 พ.ย. 2569" (default), "15 พฤศจิกายน 2569", or "15/11/2569", in Thai time. */
export function formatThaiDate(d: Date, format: FieldSettings['dateFormat'] = 'short') {
  const p = bangkokParts(d);
  const be = p.year + 543;
  if (format === 'long') return `${p.day} ${TH_MONTHS_LONG[p.month]} ${be}`;
  if (format === 'numeric') return `${p.day}/${p.month + 1}/${be}`;
  return `${p.day} ${TH_MONTHS_SHORT[p.month]} ${be}`;
}

/** Local (box) coordinates -> PDF user space. */
function toPdf(pl: Placement, lx: number, ly: number) {
  const r = (pl.angle * Math.PI) / 180;
  return { x: pl.origin.x + lx * Math.cos(r) - ly * Math.sin(r), y: pl.origin.y + lx * Math.sin(r) + ly * Math.cos(r) };
}

/**
 * Wraps the page's existing content in q/Q so a graphics state left changed by
 * the original producer cannot shift what we draw on top.
 */
function isolateExistingContent(doc: PDFDocument, page: PDFPage) {
  const node = page.node;
  const contents = node.get(PDFName.of('Contents'));
  if (!contents) return;
  const pre = doc.context.register(doc.context.stream('q\n'));
  const post = doc.context.register(doc.context.stream('\nQ\n'));
  const existing: PDFRef[] = [];
  const resolved = doc.context.lookup(contents);
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) existing.push(resolved.get(i) as PDFRef);
  } else {
    existing.push(contents as PDFRef);
  }
  node.set(PDFName.of('Contents'), doc.context.obj([pre, ...existing, post]));
}

function drawImageContain(page: PDFPage, img: PDFImage, pl: Placement, box: { x: number; y: number; w: number; h: number }) {
  const s = Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * s;
  const h = img.height * s;
  const at = toPdf(pl, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2);
  page.drawImage(img, { x: at.x, y: at.y, width: w, height: h, rotate: degrees(pl.angle) });
}

function drawTextInBox(page: PDFPage, font: ShapedFont, text: string, pl: Placement, box: { x: number; y: number; w: number; h: number }, preferred: number, align: 'left' | 'center' = 'left') {
  const pad = Math.min(2, box.w * 0.05);
  let size = preferred;
  let lines = font.wrap(text, size, box.w - 2 * pad);
  // shrink until the wrapped text fits the box height (min 5 pt)
  while (size > 5 && (lines.length * size * 1.25 > box.h || lines.some((l) => font.width(l, size) > box.w - 2 * pad))) {
    size -= 0.5;
    lines = font.wrap(text, size, box.w - 2 * pad);
  }
  const lineH = size * 1.25;
  const blockH = lines.length * lineH;
  let baseline = box.y + (box.h + blockH) / 2 - font.ascent(size) - (lineH - size) / 2;
  for (const line of lines) {
    const lw = font.width(line, size);
    const x = box.x + (align === 'center' ? (box.w - lw) / 2 : pad);
    font.draw(page, line, { x, y: baseline, size, origin: pl.origin, angle: pl.angle, color: { r: 0.05, g: 0.05, b: 0.15 } });
    baseline -= lineH;
  }
}

function drawCheck(page: PDFPage, pl: Placement) {
  const s = Math.min(pl.width, pl.height);
  const ox = (pl.width - s) / 2;
  const oy = (pl.height - s) / 2;
  const pts = [
    [0.18, 0.52],
    [0.42, 0.25],
    [0.85, 0.8],
  ].map(([x, y]) => toPdf(pl, ox + x * s, oy + y * s));
  const thickness = Math.max(1, s * 0.1);
  const color = rgb(0.05, 0.1, 0.45);
  page.drawLine({ start: pts[0], end: pts[1], thickness, color });
  page.drawLine({ start: pts[1], end: pts[2], thickness, color });
}

/** SGN-07: puts every filled field on its page, then appends the certificate page. */
export async function renderFinalPdf(input: RenderInput): Promise<PDFDocument> {
  const doc = await PDFDocument.load(input.source, { updateMetadata: false });
  const font = await ShapedFont.embed(doc, 'regular');
  const bold = await ShapedFont.embed(doc, 'bold');
  const boxes = pageBoxes(doc);
  const pages = doc.getPages();

  const sigImages = new Map<string, PDFImage>();
  for (const [id, png] of input.signatures) sigImages.set(id, await doc.embedPng(png));
  const stampImages = new Map<string, PDFImage>();
  for (const [id, png] of input.stamps) stampImages.set(id, await doc.embedPng(png));

  const touched = new Set<number>();
  for (const f of input.fields) {
    const page = pages[f.pageNo - 1];
    if (!page) continue;
    if (!touched.has(f.pageNo)) {
      isolateExistingContent(doc, page);
      touched.add(f.pageNo);
    }
    const pl = placeField(boxes[f.pageNo - 1], f);
    const full = { x: 0, y: 0, w: pl.width, h: pl.height };
    const signedAt = input.signedAt.get(f.signerId) ?? new Date();
    switch (f.type) {
      case 'signature': {
        const img = sigImages.get(f.signerId);
        if (img) drawImageContain(page, img, pl, full);
        break;
      }
      case 'date':
        drawTextInBox(page, font, formatThaiDate(signedAt, f.settings.dateFormat), pl, full, f.settings.fontSize ?? Math.min(14, pl.height * 0.6));
        break;
      case 'text':
        if (typeof f.value === 'string' && f.value) drawTextInBox(page, font, f.value, pl, full, f.settings.fontSize ?? 12);
        break;
      case 'checkbox':
        if (f.value === true) drawCheck(page, pl);
        break;
      case 'stamp': {
        const img = f.settings.stampId ? stampImages.get(f.settings.stampId) : undefined;
        if (img && f.value === true) drawImageContain(page, img, pl, full);
        break;
      }
      case 'certified_copy': {
        const h = pl.height;
        drawTextInBox(page, bold, f.settings.text || 'สำเนาถูกต้อง', pl, { x: 0, y: h * 0.72, w: pl.width, h: h * 0.28 }, Math.min(14, h * 0.2), 'center');
        const img = sigImages.get(f.signerId);
        if (img) drawImageContain(page, img, pl, { x: 0, y: h * 0.22, w: pl.width, h: h * 0.5 });
        drawTextInBox(page, font, formatThaiDate(signedAt, f.settings.dateFormat), pl, { x: 0, y: 0, w: pl.width, h: h * 0.22 }, Math.min(11, h * 0.16), 'center');
        break;
      }
    }
  }

  addCertificatePages(doc, font, bold, input.certificate);
  doc.setModificationDate(input.certificate.completedAt);
  doc.setProducer('ZenHere');
  return doc;
}

// ---------------------------------------------------------------------- certificate page

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const GRAY = { r: 0.4, g: 0.4, b: 0.43 };

function addCertificatePages(doc: PDFDocument, font: ShapedFont, bold: ShapedFont, c: CertificateData) {
  let page = doc.addPage(A4);
  let y = A4[1] - M;
  const width = A4[0] - 2 * M;

  const ensure = (needed: number) => {
    if (y - needed < M + 30) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
  };
  const text = (t: string, opts: { size?: number; f?: ShapedFont; x?: number; w?: number; color?: { r: number; g: number; b: number }; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const lines = f.wrap(t, size, opts.w ?? width);
    for (const line of lines) {
      ensure(size * 1.4);
      y -= size * 1.4;
      f.draw(page, line, { x: opts.x ?? M, y, size, color: opts.color });
    }
    y -= opts.gap ?? 0;
  };
  const row = (label: string, value: string) => {
    const size = 10;
    const lines = font.wrap(value, size, width - 130);
    ensure(lines.length * size * 1.45);
    const top = y;
    font.draw(page, label, { x: M, y: top - size * 1.4, size, color: GRAY });
    for (const line of lines) {
      y -= size * 1.45;
      font.draw(page, line, { x: M + 130, y, size });
    }
    if (!lines.length) y -= size * 1.45;
  };

  text('หน้ารับรองการลงนามอิเล็กทรอนิกส์', { size: 16, f: bold, gap: 4 });
  text('Electronic Signature Certificate · ZenHere', { size: 10, color: GRAY, gap: 10 });
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: rgb(0.8, 0.8, 0.82) });
  y -= 6;

  row('ชื่อเอกสาร', c.title);
  row('เลขที่เอกสาร', c.documentId);
  row('บริษัท', c.companyName);
  row('ผู้ส่งเอกสาร', c.creatorName);
  row('ส่งเมื่อ', c.sentAt ? thaiDateTime(c.sentAt) : '-');
  row('ลงนามครบเมื่อ', thaiDateTime(c.completedAt));
  row('จำนวนหน้าต้นฉบับ', `${c.pageCount} หน้า`);
  row('รูปแบบการลงนาม', c.signingMode === 'sequential' ? 'เรียงตามลำดับ' : 'พร้อมกัน');
  row('SHA-256 ต้นฉบับ', c.originalSha256);
  y -= 12;

  text('ผู้ลงนาม', { size: 12, f: bold, gap: 4 });
  const cols = [M, M + 28, M + 230, M + 345, M + 430];
  const header = ['ลำดับ', 'ชื่อ / ตำแหน่ง', 'เวลาลงนาม', 'IP', 'รหัสบัญชี'];
  ensure(20);
  y -= 14;
  header.forEach((h, i) => font.draw(page, h, { x: cols[i], y, size: 9, color: GRAY }));
  y -= 6;
  for (const s of c.signers) {
    const role = [s.position, s.department].filter(Boolean).join(' · ');
    const nameLines = font.wrap(s.name, 10, 195);
    const roleLines = role ? font.wrap(role, 8.5, 195) : [];
    const lineId = s.lineUserId.length > 17 ? [s.lineUserId.slice(0, 17), s.lineUserId.slice(17)] : [s.lineUserId];
    const h = Math.max(nameLines.length * 13 + roleLines.length * 11, 26) + 8;
    ensure(h);
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.4, color: rgb(0.88, 0.88, 0.9) });
    let ly = y - 13;
    font.draw(page, String(s.order), { x: cols[0], y: ly, size: 10 });
    for (const l of nameLines) {
      font.draw(page, l, { x: cols[1], y: ly, size: 10 });
      ly -= 13;
    }
    for (const l of roleLines) {
      font.draw(page, l, { x: cols[1], y: ly + 1, size: 8.5, color: GRAY });
      ly -= 11;
    }
    font.draw(page, s.signedAt ? thaiDateTime(s.signedAt) : '-', { x: cols[2], y: y - 13, size: 9 });
    font.draw(page, s.ip ?? '-', { x: cols[3], y: y - 13, size: 9 });
    lineId.forEach((part, i) => font.draw(page, part, { x: cols[4], y: y - 13 - i * 11, size: 8, color: GRAY }));
    y -= h;
  }

  if (c.replacements.length) {
    y -= 10;
    text('การเปลี่ยนตัวผู้ลงนาม', { size: 12, f: bold, gap: 2 });
    for (const r of c.replacements) {
      text(`${thaiDateTime(r.at)}  ${r.from} → ${r.to} โดย ${r.by} เหตุผล: ${r.reason}`, { size: 9 });
    }
  }

  y -= 16;
  text(
    'ผู้ลงนามทุกคนเข้าสู่ระบบด้วยบัญชีของตนเองและกดยืนยันการลงนามอิเล็กทรอนิกส์ด้วยตนเอง ระบบบันทึกเวลา หมายเลข IP และอุปกรณ์ที่ใช้ไว้ในบันทึกการทำงานที่แก้ไขไม่ได้',
    { size: 9, color: GRAY, gap: 2 },
  );
  if (c.sealedBy) text(`ไฟล์นี้ซีลด้วยใบรับรองดิจิทัลของ ${c.sealedBy} หากไฟล์ถูกแก้ไขหลังซีล โปรแกรมอ่าน PDF จะแสดงว่าลายเซ็นไม่ถูกต้อง`, { size: 9, color: GRAY, gap: 2 });
  text(`ตรวจสอบว่าไฟล์ตรงกับต้นฉบับในระบบได้ที่ ${c.verifyUrl}`, { size: 9, color: GRAY });
}
