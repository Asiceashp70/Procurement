import { config } from '../config/config';
import { card } from './flex';

type Payload = Record<string, unknown>;

/** Builds the LINE messages for each notification type. Document types are added in phase 2. */
export function buildMessages(type: string, p: Payload): unknown[] {
  const app = config().APP_ORIGIN;
  const company = String(p.companyName ?? '');
  switch (type) {
    case 'membership.approved':
      return [
        card({
          altText: `อนุมัติแล้ว: คุณเป็นสมาชิก ${company}`,
          title: 'อนุมัติการเข้าร่วมบริษัทแล้ว',
          color: '#06C755',
          rows: [['บริษัท', company]],
          note: 'จากนี้คุณจะได้รับแจ้งเตือนเอกสารที่ต้องเซ็นทาง LINE',
          button: { label: 'เปิดระบบ', url: `${app}/` },
        }),
      ];
    case 'membership.rejected':
      return [
        card({
          altText: `คำขอเข้าร่วม ${company} ไม่ได้รับอนุมัติ`,
          title: 'คำขอเข้าร่วมบริษัทไม่ได้รับอนุมัติ',
          color: '#D93025',
          rows: [
            ['บริษัท', company],
            ['เหตุผล', String(p.reason ?? '-')],
          ],
          note: 'ตรวจสอบข้อมูลแล้วส่งคำขอใหม่ได้ หรือติดต่อฝ่ายบุคคล',
          button: { label: 'เปิดระบบ', url: `${app}/` },
        }),
      ];
    default:
      throw new Error(`no LINE template for notification type ${type}`);
  }
}
