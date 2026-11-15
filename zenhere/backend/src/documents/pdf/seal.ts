import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import signpdf from '@signpdf/signpdf';
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import forge from 'node-forge';
import { createHash, createPrivateKey, randomBytes, sign as cryptoSign, type KeyObject } from 'node:crypto';
import type { PDFDocument } from 'pdf-lib';

const { asn1 } = forge;
const U = asn1.Class.UNIVERSAL;
const T = asn1.Type;

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  timeStampToken: '1.2.840.113549.1.9.16.2.14',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
};

export class CertificateError extends Error {}

export interface SealMaterial {
  privateKey: KeyObject;
  certDer: Buffer;
  chainDer: Buffer[];
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
}

const oid = (o: string) => asn1.create(U, T.OID, false, asn1.oidToDer(o).getBytes());
const seq = (items: forge.asn1.Asn1[]) => asn1.create(U, T.SEQUENCE, true, items);
const set = (items: forge.asn1.Asn1[]) => asn1.create(U, T.SET, true, items);
const octets = (b: Buffer) => asn1.create(U, T.OCTETSTRING, false, b.toString('binary'));
const int = (n: number) => asn1.create(U, T.INTEGER, false, asn1.integerToDer(n).getBytes());
const der = (node: forge.asn1.Asn1) => Buffer.from(asn1.toDer(node).getBytes(), 'binary');
const fromDer = (b: Buffer) => asn1.fromDer(forge.util.createBuffer(b.toString('binary')));
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();
const dn = (attrs: forge.pki.CertificateField[]) => attrs.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', ');

/** ADM-11: opens a company .p12/.pfx. Throws CertificateError with a Thai message. */
export function readP12(p12: Buffer, password: string): SealMaterial {
  let bundle: forge.pkcs12.Pkcs12Pfx;
  try {
    bundle = forge.pkcs12.pkcs12FromAsn1(fromDer(p12), false, password);
  } catch (err) {
    const msg = String((err as Error).message);
    if (/password|MAC/i.test(msg)) throw new CertificateError('รหัสผ่านใบรับรองไม่ถูกต้อง');
    throw new CertificateError('อ่านไฟล์ใบรับรองไม่ได้ ต้องเป็นไฟล์ .p12 หรือ .pfx ที่มีกุญแจส่วนตัว (RSA)');
  }
  const keyBags = [
    ...(bundle.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(bundle.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const key = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new CertificateError('ไม่พบกุญแจส่วนตัวในไฟล์ใบรับรอง (รองรับกุญแจ RSA)');
  const certs = (bundle.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  const signer = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n));
  if (!signer) throw new CertificateError('ไม่พบใบรับรองที่ตรงกับกุญแจส่วนตัว');
  const toDer = (c: forge.pki.Certificate) => der(forge.pki.certificateToAsn1(c));
  return {
    privateKey: createPrivateKey(forge.pki.privateKeyToPem(key)),
    certDer: toDer(signer),
    chainDer: certs.filter((c) => c !== signer).map(toDer),
    subject: dn(signer.subject.attributes),
    issuer: dn(signer.issuer.attributes),
    serialNumber: signer.serialNumber,
    notBefore: signer.validity.notBefore,
    notAfter: signer.validity.notAfter,
  };
}

/** issuer Name and serialNumber nodes copied from the certificate's own encoding */
function issuerAndSerial(certDer: Buffer) {
  const tbs = (fromDer(certDer).value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
  const off = tbs[0].tagClass === asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
  return { serial: tbs[off], issuer: tbs[off + 2] };
}

/** DER SET OF must be sorted by encoding. */
function derSetOf(items: forge.asn1.Asn1[]) {
  const sorted = items.map((i) => ({ node: i, bytes: der(i) })).sort((a, b) => Buffer.compare(a.bytes, b.bytes));
  return sorted.map((s) => s.node);
}

const attribute = (type: string, value: forge.asn1.Asn1) => seq([oid(type), set([value])]);

/**
 * CMS SignedData for PAdES baseline-B (SubFilter ETSI.CAdES.detached): signed
 * attributes contentType, messageDigest and ESS signing-certificate-v2; no
 * signing-time attribute (the time is the signature dictionary's /M).
 */
export async function buildCadesSignature(content: Buffer, m: SealMaterial, tsaUrl?: string): Promise<{ cms: Buffer; timestamped: boolean }> {
  const { issuer, serial } = issuerAndSerial(m.certDer);
  const essCertIdV2 = seq([octets(sha256(m.certDer)), seq([seq([asn1.create(asn1.Class.CONTEXT_SPECIFIC, 4, true, [issuer])]), serial])]);
  const signedAttrs = derSetOf([
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.messageDigest, octets(sha256(content))),
    attribute(OID.signingCertificateV2, seq([seq([essCertIdV2])])),
  ]);
  const toSign = der(set(signedAttrs)); // signature covers the attributes encoded as a SET
  const isEc = m.privateKey.asymmetricKeyType === 'ec';
  const signature = cryptoSign('sha256', toSign, m.privateKey);

  const signerInfo: forge.asn1.Asn1[] = [
    int(1),
    seq([issuer, serial]),
    seq([oid(OID.sha256), asn1.create(U, T.NULL, false, '')]),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, signedAttrs),
    isEc ? seq([oid(OID.ecdsaWithSha256)]) : seq([oid(OID.rsaEncryption), asn1.create(U, T.NULL, false, '')]),
    octets(signature),
  ];

  let timestamped = false;
  if (tsaUrl) {
    const token = await requestTimestamp(tsaUrl, sha256(signature));
    signerInfo.push(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [attribute(OID.timeStampToken, token)]));
    timestamped = true;
  }

  const signedData = seq([
    int(1),
    set([seq([oid(OID.sha256), asn1.create(U, T.NULL, false, '')])]),
    seq([oid(OID.data)]),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [m.certDer, ...m.chainDer].map(fromDer)),
    set([seq(signerInfo)]),
  ]);
  const contentInfo = seq([oid(OID.signedData), asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData])]);
  return { cms: der(contentInfo), timestamped };
}

/** RFC 3161: asks a Time Stamping Authority to timestamp the signature value. */
export async function requestTimestamp(url: string, digest: Buffer): Promise<forge.asn1.Asn1> {
  const nonce = randomBytes(8);
  nonce[0] &= 0x7f; // positive INTEGER
  const req = seq([
    int(1),
    seq([seq([oid(OID.sha256), asn1.create(U, T.NULL, false, '')]), octets(digest)]),
    asn1.create(U, T.INTEGER, false, nonce.toString('binary')),
    asn1.create(U, T.BOOLEAN, false, String.fromCharCode(0xff)), // certReq
  ]);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/timestamp-query' },
    body: der(req),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TSA HTTP ${res.status}`);
  const resp = fromDer(Buffer.from(await res.arrayBuffer())).value as forge.asn1.Asn1[];
  const statusInfo = resp[0].value as forge.asn1.Asn1[];
  const status = forge.util.createBuffer(statusInfo[0].value as string).getInt(8 * (statusInfo[0].value as string).length);
  if (status !== 0 && status !== 1) throw new Error(`TSA refused the request (status ${status})`);
  if (!resp[1]) throw new Error('TSA response has no token');
  return resp[1];
}

class CadesSigner extends Signer {
  timestamped = false;
  constructor(
    private readonly material: SealMaterial,
    private readonly tsaUrl?: string,
  ) {
    super();
  }
  async sign(content: Buffer): Promise<Buffer> {
    const r = await buildCadesSignature(content, this.material, this.tsaUrl);
    this.timestamped = r.timestamped;
    return r.cms;
  }
}

/**
 * SGN-11: seals the finished PDF with the company certificate (invisible signature,
 * shown in Adobe Reader's signature panel). Must be the very last change to the file.
 */
export async function sealPdf(
  doc: PDFDocument,
  material: SealMaterial,
  opts: { name: string; reason: string; location: string; tsaUrl?: string; signingTime?: Date },
): Promise<{ pdf: Buffer; timestamped: boolean }> {
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: opts.reason,
    contactInfo: '',
    name: opts.name,
    location: opts.location,
    signingTime: opts.signingTime,
    signatureLength: 24_000,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    widgetRect: [0, 0, 0, 0],
  });
  const unsigned = Buffer.from(await doc.save({ useObjectStreams: false }));
  const signer = new CadesSigner(material, opts.tsaUrl);
  const pdf = await signpdf.sign(unsigned, signer, opts.signingTime);
  return { pdf, timestamped: signer.timestamped };
}
