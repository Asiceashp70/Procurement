const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** Parts of a date in Thai time (UTC+7, no daylight saving) regardless of the device's zone. */
function bkk(d: Date) {
  const t = new Date(d.getTime() + 7 * 3600_000);
  return { y: t.getUTCFullYear() + 543, m: t.getUTCMonth(), d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}

export function thaiDate(value: string | Date | null | undefined) {
  if (!value) return '-';
  const p = bkk(new Date(value));
  return `${p.d} ${MONTHS[p.m]} ${p.y}`;
}

export function thaiDateTime(value: string | Date | null | undefined) {
  if (!value) return '-';
  const p = bkk(new Date(value));
  return `${p.d} ${MONTHS[p.m]} ${p.y} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** yyyy-mm-dd (Thai calendar day) -> ISO instant at 00:00 Bangkok */
export const bangkokDayStart = (day: string) => new Date(`${day}T00:00:00+07:00`).toISOString();

export const STATUS_LABEL: Record<string, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ถูกปฏิเสธ',
  suspended: 'ถูกระงับ',
  active: 'ใช้งาน',
};

export const fullName = (u: { firstName?: string | null; lastName?: string | null; lineDisplayName?: string | null }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.lineDisplayName || '-';
