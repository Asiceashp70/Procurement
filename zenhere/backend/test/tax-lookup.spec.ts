import { lookupTaxId, parseVatResponse, RD_VAT_URL } from '../src/admin/tax-lookup';

const arr = (...v: string[]) => v.map((x) => `<anyType xsi:type="xsd:string">${x}</anyType>`).join('');
const soap = (fields: Record<string, string[]>) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><ServiceResponse xmlns="https://rdws.rd.go.th/serviceRD3/vatserviceRD3"><ServiceResult>${Object.entries(
    fields,
  )
    .map(([k, v]) => `<${k}>${arr(...v)}</${k}>`)
    .join('')}</ServiceResult></ServiceResponse></soap:Body></soap:Envelope>`;

const company = soap({
  vNID: ['0105556000017', '0105556000017'],
  vtitleName: ['บริษัท', 'บริษัท'],
  vName: ['ทดลอง &amp; ตัวอย่าง จำกัด', 'ทดลอง &amp; ตัวอย่าง จำกัด'],
  vSurname: ['-', '-'],
  vBranchNumber: ['1', '0'],
  vBranchName: ['บางนา', '-'],
  vBuildingName: ['-', 'สาทรทาวเวอร์'],
  vFloorNumber: ['-', '12'],
  vRoomNumber: ['-', '-'],
  vVillageName: ['-', '-'],
  vHouseNumber: ['5', '99/1'],
  vMooNumber: ['-', '-'],
  vSoiName: ['-', 'สาทร 1'],
  vStreetName: ['-', 'สาทรใต้'],
  vThambol: ['-', 'ทุ่งมหาเมฆ'],
  vAmphur: ['-', 'สาทร'],
  vProvince: ['กรุงเทพมหานคร', 'กรุงเทพมหานคร'],
  vPostCode: ['10260', '10120'],
  vmsgerr: [],
});

describe('Revenue Department tax ID lookup', () => {
  it('reads the head office name and builds a Thai address', () => {
    expect(parseVatResponse(company)).toEqual({
      name: 'บริษัท ทดลอง & ตัวอย่าง จำกัด',
      address: 'เลขที่ 99/1 อาคารสาทรทาวเวอร์ ชั้น 12 ซอยสาทร 1 ถนนสาทรใต้ แขวงทุ่งมหาเมฆ เขตสาทร กรุงเทพมหานคร 10120',
      branch: 'สำนักงานใหญ่',
    });
  });

  it('uses ตำบล/อำเภอ/จังหวัด outside Bangkok and keeps a person name', () => {
    const r = parseVatResponse(
      soap({ vtitleName: ['นาย'], vName: ['สมชาย'], vSurname: ['ใจดี'], vBranchNumber: ['0'], vHouseNumber: ['1'], vMooNumber: ['3'], vThambol: ['ในเมือง'], vAmphur: ['เมืองขอนแก่น'], vProvince: ['ขอนแก่น'], vPostCode: ['40000'] }),
    );
    expect(r).toEqual({ name: 'นาย สมชาย ใจดี', address: 'เลขที่ 1 หมู่ที่ 3 ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000', branch: 'สำนักงานใหญ่' });
  });

  it('returns null when not registered', () => {
    expect(parseVatResponse(soap({ vmsgerr: ['ไม่พบข้อมูล'] }))).toBeNull();
    expect(parseVatResponse(soap({ vName: [] }))).toBeNull();
  });

  it('calls the SOAP service and maps errors to friendly messages', async () => {
    const calls: { url: string; body: string }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(company, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(lookupTaxId('0105556000017', ok)).resolves.toMatchObject({ taxId: '0105556000017', branch: 'สำนักงานใหญ่' });
    expect(calls[0].url).toBe(RD_VAT_URL);
    expect(calls[0].body).toContain('<TIN>0105556000017</TIN>');

    await expect(lookupTaxId('0105556000018', ok)).rejects.toThrow('ไม่ถูกต้อง');
    const down = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(lookupTaxId('0105556000017', down)).rejects.toThrow('ติดต่อระบบกรมสรรพากรไม่ได้');
    const none = (async () => new Response(soap({ vmsgerr: ['ไม่พบข้อมูล'] }))) as unknown as typeof fetch;
    await expect(lookupTaxId('0105556000017', none)).rejects.toThrow('ไม่พบเลขนี้');
  });
});
