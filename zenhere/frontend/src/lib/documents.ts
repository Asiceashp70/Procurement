import type { PageInfo } from './pdf';

export type FieldType = 'signature' | 'date' | 'text' | 'checkbox' | 'stamp' | 'certified_copy';
export type DocStatus = 'draft' | 'pending' | 'completed' | 'declined' | 'voided';
export type SignerStatus = 'waiting' | 'pending' | 'signed' | 'declined' | 'replaced';

export interface FieldSettings {
  label?: string;
  required?: boolean;
  maxLength?: number;
  fontSize?: number;
  dateFormat?: 'short' | 'long' | 'numeric';
  stampId?: string;
  text?: string;
}

export interface EditorField {
  id: string;
  signerUserId: string;
  pageNo: number;
  type: FieldType;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: FieldSettings;
}

export interface DocSigner {
  id: string;
  userId: string;
  order: number;
  status: SignerStatus;
  displayName: string | null;
  positionName: string | null;
  departmentName: string | null;
  firstName: string | null;
  lastName: string | null;
  linePictureUrl: string | null;
  isOaFriend: boolean;
  notifiedAt: string | null;
  openedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  reminderCount: number;
  lastRemindedAt: string | null;
  replacedReason: string | null;
}

export interface DocDetail {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  description: string | null;
  docType: string | null;
  tags: string[];
  status: DocStatus;
  overdue: boolean;
  signingMode: 'parallel' | 'sequential';
  dueAt: string | null;
  notifyCreatorOnSign: boolean;
  originalName: string;
  pageCount: number;
  originalSha256: string;
  finalSha256: string | null;
  finalReady: boolean;
  sealStatus: 'none' | 'sealed' | 'no_certificate' | 'failed';
  timestamped: boolean;
  textStatus: 'pending' | 'extracting' | 'ocr' | 'ready' | 'failed';
  ocrPages: number;
  ocrFailedPages: number;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  voidReason: string | null;
  creatorId: string;
  creatorName: string;
  pages: PageInfo[];
  signers: DocSigner[];
  fields: EditorField[];
  events: { id: string; type: string; createdAt: string; details: Record<string, unknown>; ip: string | null; actorName: string }[];
  me: { roles: string[]; signerStatus: SignerStatus | null; canEdit: boolean; canSign: boolean; canRemind: boolean; canVoid: boolean; canReplaceSigner: boolean };
}

export interface DocListItem {
  id: string;
  title: string;
  status: DocStatus;
  docType: string | null;
  tags: string[];
  dueAt: string | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  pageCount: number;
  creatorName: string;
  myStatus: SignerStatus | null;
  signedCount: number;
  signerCount: number;
  overdue: boolean;
  finalReady: boolean;
}

export interface Candidate {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  linePictureUrl: string | null;
  isOaFriend: boolean;
  employeeCode: string | null;
  departmentName: string | null;
  positionName: string | null;
}

export const DOC_STATUS: Record<DocStatus, string> = {
  draft: 'ร่าง',
  pending: 'รอเซ็น',
  completed: 'เซ็นครบ',
  declined: 'ถูกปฏิเสธ',
  voided: 'ยกเลิก',
};
export const DOC_BADGE: Record<DocStatus, string> = { draft: 'badge-admin', pending: 'badge-pending', completed: 'badge-approved', declined: 'badge-rejected', voided: 'badge-suspended' };

export const SIGNER_STATUS: Record<SignerStatus, string> = {
  waiting: 'ยังไม่ถึงลำดับ',
  pending: 'รอเซ็น',
  signed: 'เซ็นแล้ว',
  declined: 'ปฏิเสธ',
  replaced: 'ถูกเปลี่ยนตัว',
};

export const FIELD_LABEL: Record<FieldType, string> = {
  signature: 'ลายเซ็น',
  date: 'วันที่',
  text: 'ข้อความ',
  checkbox: 'Checkbox',
  stamp: 'ตราประทับ',
  certified_copy: 'สำเนาถูกต้อง',
};
export const FIELD_ICON: Record<FieldType, string> = { signature: '✍️', date: '📅', text: '🔤', checkbox: '☑️', stamp: '🔴', certified_copy: '📄' };

/** Default size in PDF points; converted to fractions of the page when placed. */
export const FIELD_SIZE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 150, h: 50 },
  date: { w: 110, h: 20 },
  text: { w: 180, h: 22 },
  checkbox: { w: 16, h: 16 },
  stamp: { w: 85, h: 85 },
  certified_copy: { w: 140, h: 80 },
};

export const SIGNER_COLORS = ['#1a5fb4', '#c64600', '#2a7d2a', '#8e44ad', '#b8860b', '#00838f', '#c2185b', '#455a64'];

export const EVENT_LABEL: Record<string, string> = {
  created: 'สร้างเอกสาร',
  sent: 'ส่งเอกสาร',
  opened: 'เปิดดู',
  signed: 'เซ็นแล้ว',
  declined: 'ปฏิเสธการเซ็น',
  reminded: 'เตือนซ้ำ',
  voided: 'ยกเลิกเอกสาร',
  downloaded: 'ดาวน์โหลด',
  signer_replaced: 'เปลี่ยนตัวผู้เซ็น',
  completed: 'เซ็นครบทุกคน',
  finalized: 'สร้างไฟล์ฉบับสมบูรณ์',
  viewed_by_admin: 'ผู้ดูแลเปิดดู',
  sign_denied: 'พยายามเซ็นโดยไม่มีสิทธิ์',
};

/** Thai date shown in the date field before the real signing time is known. */
export function todayThai(format: FieldSettings['dateFormat'] = 'short') {
  const t = new Date(Date.now() + 7 * 3600_000);
  const short = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const long = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const d = t.getUTCDate();
  const m = t.getUTCMonth();
  const y = t.getUTCFullYear() + 543;
  if (format === 'long') return `${d} ${long[m]} ${y}`;
  if (format === 'numeric') return `${d}/${m + 1}/${y}`;
  return `${d} ${short[m]} ${y}`;
}

export const candidateName = (c: { firstName: string | null; lastName: string | null; displayName?: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ') || c.displayName || '-';
