import { BadGatewayException, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { isValidThaiTaxId } from '../companies/thai-tax-id';

/**
 * Looks up a VAT-registered business by its 13-digit tax ID with the Revenue Department's
 * public web service (vatserviceRD3, SOAP, anonymous access). Only VAT registrants are
 * listed there; anyone else gets "not found" and is typed in by hand.
 */
export const RD_VAT_URL = 'https://rdws.rd.go.th/serviceRD3/vatserviceRD3.asmx';
const NS = 'https://rdws.rd.go.th/serviceRD3/vatserviceRD3';
const log = new Logger('TaxLookup');

export interface TaxLookupResult {
  taxId: string;
  name: string;
  address: string;
  branch: string;
}

export async function lookupTaxId(taxId: string, fetchImpl: typeof fetch = fetch): Promise<TaxLookupResult> {
  if (!isValidThaiTaxId(taxId)) throw new BadRequestException('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง');
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Service xmlns="${NS}">
<username>anonymous</username><password>anonymous</password><TIN>${taxId}</TIN>
<ProvinceCode>0</ProvinceCode><BranchNumber>0</BranchNumber><AmphurCode>0</AmphurCode>
</Service></soap:Body></soap:Envelope>`;
  let xml: string;
  try {
    const res = await fetchImpl(RD_VAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}/Service"` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    xml = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    log.warn(`Revenue Department lookup failed: ${(err as Error).message}`);
    throw new BadGatewayException('ติดต่อระบบกรมสรรพากรไม่ได้ในขณะนี้ กรุณากรอกข้อมูลเอง');
  }
  const r = parseVatResponse(xml);
  if (!r) throw new NotFoundException('ไม่พบเลขนี้ในทะเบียนผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม กรุณากรอกข้อมูลเอง');
  return { taxId, ...r };
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Each output field is an array (one item per branch): <vName><anyType>..</anyType></vName> */
function field(xml: string, name: string): string[] {
  const m = new RegExp(`<${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${name}>)`, 'i').exec(xml);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/<(?:\w+:)?anyType\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?anyType>)/gi)].map((a) => decode(a[1] ?? ''));
}

const blank = (v: string | undefined) => !v || v === '-';

export function parseVatResponse(xml: string): Omit<TaxLookupResult, 'taxId'> | null {
  if (field(xml, 'vmsgerr').some((e) => e && e !== '-')) return null;
  const names = field(xml, 'vName');
  if (!names.length || !names[0]) return null;
  const branches = field(xml, 'vBranchNumber');
  let i = branches.findIndex((b) => Number(b) === 0); // head office first
  if (i < 0) i = 0;
  const get = (n: string) => {
    const v = field(xml, n)[i];
    return blank(v) ? '' : v;
  };

  const title = get('vtitleName');
  let name = get('vName');
  const surname = get('vSurname');
  if (title && !name.startsWith(title)) name = `${title} ${name}`;
  if (surname) name = `${name} ${surname}`;

  const province = get('vProvince');
  const bangkok = /กรุงเทพ/.test(province);
  const prefixed = (prefix: string, v: string) => (!v ? '' : v.startsWith(prefix) ? v : `${prefix}${v}`);
  const address = [
    get('vHouseNumber') && `เลขที่ ${get('vHouseNumber')}`,
    prefixed('อาคาร', get('vBuildingName')),
    get('vRoomNumber') && `ห้อง ${get('vRoomNumber')}`,
    get('vFloorNumber') && `ชั้น ${get('vFloorNumber')}`,
    prefixed('หมู่บ้าน', get('vVillageName')),
    get('vMooNumber') && `หมู่ที่ ${get('vMooNumber')}`,
    prefixed('ซอย', get('vSoiName')),
    prefixed('ถนน', get('vStreetName')),
    prefixed(bangkok ? 'แขวง' : 'ตำบล', get('vThambol')),
    prefixed(bangkok ? 'เขต' : 'อำเภอ', get('vAmphur')),
    bangkok ? province : prefixed('จังหวัด', province),
    get('vPostCode'),
  ]
    .filter(Boolean)
    .join(' ');

  const branchNo = Number(get('vBranchNumber') || 0);
  const branch = branchNo === 0 ? 'สำนักงานใหญ่' : `สาขาที่ ${String(branchNo).padStart(5, '0')}${get('vBranchName') ? ` ${get('vBranchName')}` : ''}`;
  return { name, address, branch };
}
