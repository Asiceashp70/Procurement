import { thaiDateTime } from '../common/thai-time';
import { card, type CardInput } from './flex';
import { appLink } from './links';

type Payload = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? '-' : String(v));
const due = (p: Payload) => (p.dueAt ? thaiDateTime(new Date(String(p.dueAt))) : '-');

/** Builds the LINE Flex message for each notification type. */
export function buildMessages(type: string, p: Payload): unknown[] {
  return buildCards(type, p).map(card);
}

/** The content of each message, also shown by the test LINE inbox when LINE is not connected. */
export function buildCards(type: string, p: Payload): CardInput[] {
  const company = s(p.companyName);
  const signUrl = appLink(`/documents/${s(p.documentId)}/sign`);
  const docUrl = appLink(`/documents/${s(p.documentId)}`);
  const docRows = (): [string, string][] => [
    ['เอกสาร', s(p.title)],
    ['ผู้ส่ง', s(p.senderName)],
    ['กำหนด', due(p)],
  ];

  switch (type) {
    // ------------------------------------------------------------ membership
    case 'membership.approved':
      return [({ altText: `อนุมัติแล้ว: คุณเป็นสมาชิก ${company}`, title: 'อนุมัติการเข้าร่วมบริษัทแล้ว', color: '#06C755', rows: [['บริษัท', company]], note: 'จากนี้คุณจะได้รับแจ้งเตือนเมื่อมีเอกสารให้เซ็น', button: { label: 'เปิดระบบ', url: appLink('/') } })];
    case 'membership.rejected':
      return [
        ({
          altText: `คำขอเข้าร่วม ${company} ไม่ได้รับอนุมัติ`,
          title: 'คำขอเข้าร่วมบริษัทไม่ได้รับอนุมัติ',
          color: '#D93025',
          rows: [
            ['บริษัท', company],
            ['เหตุผล', s(p.reason)],
          ],
          note: 'ตรวจสอบข้อมูลแล้วส่งคำขอใหม่ได้ หรือติดต่อฝ่ายบุคคล',
          button: { label: 'เปิดระบบ', url: appLink('/') },
        }),
      ];

    // ------------------------------------------------------------ to signers
    case 'doc.sign_request':
      return [({ altText: `มีเอกสารรอคุณเซ็น: ${s(p.title)}`, title: 'มีเอกสารรอคุณเซ็น', color: '#06C755', rows: docRows(), button: { label: 'เปิดเพื่อเซ็น', url: signUrl } })];
    case 'doc.reminder':
      return [({ altText: `เตือน: ${s(p.title)} รอคุณเซ็น`, title: 'เตือน: เอกสารรอคุณเซ็น', color: '#B26A00', rows: docRows(), button: { label: 'เปิดเพื่อเซ็น', url: signUrl } })];
    case 'doc.due_soon':
      return [({ altText: `ใกล้ครบกำหนด: ${s(p.title)}`, title: 'เอกสารใกล้ครบกำหนดเซ็น', color: '#B26A00', rows: docRows(), button: { label: 'เปิดเพื่อเซ็น', url: signUrl } })];
    case 'doc.overdue':
      return [({ altText: `เลยกำหนดแล้ว: ${s(p.title)}`, title: 'เอกสารเลยกำหนดเซ็นแล้ว', color: '#D93025', rows: docRows(), note: 'ยังเซ็นได้ กรุณาเซ็นโดยเร็ว', button: { label: 'เปิดเพื่อเซ็น', url: signUrl } })];
    case 'doc.voided':
      return [
        ({
          altText: `ยกเลิกเอกสาร: ${s(p.title)}`,
          title: 'เอกสารถูกยกเลิก',
          color: '#6B6B70',
          rows: [
            ['เอกสาร', s(p.title)],
            ['ยกเลิกโดย', s(p.actorName)],
            ['เหตุผล', s(p.reason)],
          ],
          note: 'คุณไม่ต้องเซ็นเอกสารนี้แล้ว',
        }),
      ];
    case 'doc.signer_assigned':
      return [
        ({
          altText: `คุณถูกกำหนดเป็นผู้เซ็น: ${s(p.title)}`,
          title: 'คุณถูกกำหนดเป็นผู้เซ็นแทน',
          rows: [...docRows(), ['เหตุผล', s(p.reason)]],
          note: 'ระบบจะแจ้งอีกครั้งเมื่อถึงลำดับของคุณ',
        }),
      ];
    case 'doc.signer_removed':
      return [
        ({
          altText: `คุณไม่ต้องเซ็น ${s(p.title)} แล้ว`,
          title: 'เปลี่ยนผู้เซ็นแล้ว',
          color: '#6B6B70',
          rows: [
            ['เอกสาร', s(p.title)],
            ['ผู้เซ็นแทน', s(p.newSignerName)],
            ['เหตุผล', s(p.reason)],
          ],
          note: 'คุณไม่ต้องเซ็นเอกสารนี้แล้ว',
        }),
      ];
    case 'doc.completed':
      return [
        ({
          altText: `เซ็นครบแล้ว: ${s(p.title)}`,
          title: 'เอกสารเซ็นครบแล้ว',
          color: '#06C755',
          rows: [
            ['เอกสาร', s(p.title)],
            ['บริษัท', company],
          ],
          note: 'เปิดดูและดาวน์โหลดไฟล์ฉบับสมบูรณ์ได้ (ต้องเข้าสู่ระบบ)',
          button: { label: 'เปิดไฟล์', url: docUrl },
        }),
      ];

    // ------------------------------------------------------------ to the creator
    case 'doc.signed':
      return [
        ({
          altText: `${s(p.signerName)} เซ็นแล้ว: ${s(p.title)}`,
          title: `${s(p.signerName)} เซ็นแล้ว`,
          rows: [
            ['เอกสาร', s(p.title)],
            ['ความคืบหน้า', `${s(p.signed)}/${s(p.total)} คน`],
          ],
          button: { label: 'ดูเอกสาร', url: docUrl },
        }),
      ];
    case 'doc.declined':
      return [
        ({
          altText: `${s(p.signerName)} ปฏิเสธการเซ็น: ${s(p.title)}`,
          title: 'เอกสารถูกปฏิเสธ',
          color: '#D93025',
          rows: [
            ['เอกสาร', s(p.title)],
            ['ผู้ปฏิเสธ', s(p.signerName)],
            ['เหตุผล', s(p.reason)],
          ],
          button: { label: 'ดูเอกสาร', url: docUrl },
        }),
      ];
    case 'doc.overdue_creator':
      return [({ altText: `เลยกำหนด: ${s(p.title)} ยังเซ็นไม่ครบ`, title: 'เอกสารเลยกำหนดแต่ยังเซ็นไม่ครบ', color: '#D93025', rows: [['เอกสาร', s(p.title)], ['ยังไม่เซ็น', s(p.pendingNames)]], button: { label: 'ดูเอกสาร', url: docUrl } })];
    case 'doc.signer_replaced':
      return [
        ({
          altText: `เปลี่ยนผู้เซ็น: ${s(p.title)}`,
          title: 'Admin เปลี่ยนตัวผู้เซ็น',
          rows: [
            ['เอกสาร', s(p.title)],
            ['จาก', s(p.oldSignerName)],
            ['เป็น', s(p.newSignerName)],
            ['เหตุผล', s(p.reason)],
          ],
          button: { label: 'ดูเอกสาร', url: docUrl },
        }),
      ];
    case 'signer.suspended':
      return [
        ({
          altText: `ผู้เซ็นถูกระงับ: ${s(p.title)}`,
          title: 'ผู้เซ็นถูกระงับบัญชี',
          color: '#B26A00',
          rows: [
            ['เอกสาร', s(p.title)],
            ['ผู้เซ็น', s(p.signerName)],
          ],
          note: 'ผู้ดูแลบริษัทเปลี่ยนตัวผู้เซ็นได้ในหน้าเอกสาร',
          button: { label: 'ดูเอกสาร', url: docUrl },
        }),
      ];

    // ------------------------------------------------------------ to admins
    case 'cert.expiring':
      return [
        ({
          altText: `ใบรับรองดิจิทัลของ ${company} ใกล้หมดอายุ`,
          title: `ใบรับรองดิจิทัลจะหมดอายุใน ${s(p.daysLeft)} วัน`,
          color: '#B26A00',
          rows: [
            ['บริษัท', company],
            ['ใบรับรอง', s(p.subject)],
            ['หมดอายุ', p.notAfter ? thaiDateTime(new Date(String(p.notAfter))) : '-'],
          ],
          note: 'ต่ออายุแล้วให้ Super Admin อัปโหลดไฟล์ใหม่ ถ้าหมดอายุ เอกสารจะปิดได้แต่ไม่ถูกซีล',
        }),
      ];
    case 'cert.missing':
      return [
        ({
          altText: `เอกสาร ${s(p.title)} ปิดแล้วแต่ไม่ได้ซีล`,
          title: 'เอกสารปิดแล้วแต่ไม่ได้ซีลดิจิทัล',
          color: '#D93025',
          rows: [
            ['บริษัท', company],
            ['เอกสาร', s(p.title)],
            ['สาเหตุ', s(p.reason)],
          ],
          button: { label: 'ดูเอกสาร', url: docUrl },
        }),
      ];
    default:
      throw new Error(`no LINE template for notification type ${type}`);
  }
}
