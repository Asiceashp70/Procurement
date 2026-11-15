import forge from 'node-forge';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { PDFDocument, rgb } from 'pdf-lib';
import { ShapedFont } from '../documents/pdf/thai-text';

// ------------------------------------------------------------------ PNG

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** RGBA pixels -> PNG (color type 6, transparent background). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

class Canvas {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint8Array(w * h * 4);
  }
  /** soft round dot, used to draw thick strokes */
  dot(cx: number, cy: number, r: number, [cr, cg, cb]: [number, number, number]) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const a = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x - cx, y - cy)));
        if (!a) continue;
        const o = (y * this.w + x) * 4;
        this.px[o] = cr;
        this.px[o + 1] = cg;
        this.px[o + 2] = cb;
        this.px[o + 3] = Math.max(this.px[o + 3], Math.round(a * 255));
      }
    }
  }
  path(points: [number, number][], width: (t: number) => number, color: [number, number, number]) {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= steps; s++) this.dot(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, width(i / points.length), color);
    }
  }
  png() {
    return encodePng(this.w, this.h, this.px);
  }
}

/** A different-looking handwritten-style signature for each seed. */
export function signaturePng(seed: number, color: [number, number, number] = [17, 17, 17]): Buffer {
  const c = new Canvas(460, 150);
  const rnd = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + 0.5;
  const pts: [number, number][] = [];
  const loops = 3 + Math.floor(rnd(1) * 3);
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const x = 30 + t * 380 + Math.sin(t * Math.PI * 2 * loops) * 18 * rnd(2);
    const y = 80 + Math.sin(t * Math.PI * (2 + rnd(3) * 3)) * 32 * (1 - t * 0.4) + Math.cos(t * Math.PI * 2 * loops) * 22 * rnd(4);
    pts.push([x, y]);
  }
  c.path(pts, (t) => 1.6 + 1.4 * Math.sin(t * Math.PI), color);
  // underline flourish
  c.path(
    Array.from({ length: 60 }, (_, i) => [140 + i * 4.5, 128 - Math.sin(i / 60) * 6] as [number, number]),
    () => 1.4,
    color,
  );
  return c.png();
}

/** A red round company stamp (double ring and a star). */
export function stampPng(): Buffer {
  const S = 240;
  const c = new Canvas(S, S);
  const red: [number, number, number] = [200, 30, 40];
  const ring = (r: number, w: number) =>
    c.path(
      Array.from({ length: 361 }, (_, i) => [S / 2 + r * Math.cos((i * Math.PI) / 180), S / 2 + r * Math.sin((i * Math.PI) / 180)] as [number, number]),
      () => w,
      red,
    );
  ring(110, 4);
  ring(96, 2);
  ring(52, 2);
  const star: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const r = i % 2 ? 18 : 42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    star.push([S / 2 + r * Math.cos(a), S / 2 + r * Math.sin(a)]);
  }
  c.path(star, () => 2.5, red);
  return c.png();
}

// ------------------------------------------------------------------ certificate

/** Self-signed company certificate for testing the seal. Not trusted by Adobe; never use in production. */
export function testCertificateP12(commonName: string, password: string): Buffer {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  cert.serialNumber = '01' + randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'LINE e-Sign TEST ONLY' },
    { name: 'countryName', value: 'TH' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

// ------------------------------------------------------------------ sample PDFs

export async function thaiPdf(title: string, paragraphs: string[][], footer?: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await ShapedFont.embed(doc);
  const bold = await ShapedFont.embed(doc, 'bold');
  for (const lines of paragraphs) {
    const page = doc.addPage([595.28, 841.89]);
    bold.draw(page, title, { x: 60, y: 770, size: 20 });
    page.drawLine({ start: { x: 60, y: 758 }, end: { x: 535, y: 758 }, thickness: 0.8, color: rgb(0.7, 0.7, 0.72) });
    let y = 725;
    for (const text of lines) {
      for (const line of font.wrap(text, 14, 475)) {
        font.draw(page, line, { x: 60, y, size: 14 });
        y -= 22;
      }
      y -= 8;
    }
    if (footer) font.draw(page, footer, { x: 60, y: 60, size: 10, color: { r: 0.5, g: 0.5, b: 0.5 } });
  }
  return Buffer.from(await doc.save());
}
