const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Wall-clock parts in Asia/Bangkok (no DST, always UTC+7). */
export function bangkokParts(d: Date) {
  const t = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth(), day: t.getUTCDate(), hour: t.getUTCHours(), minute: t.getUTCMinutes() };
}

/** "15 พ.ย. 2569" */
export function thaiDate(d: Date) {
  const p = bangkokParts(d);
  return `${p.day} ${TH_MONTHS_SHORT[p.month]} ${p.year + 543}`;
}

/** "15 พ.ย. 2569 14:05" */
export function thaiDateTime(d: Date) {
  const p = bangkokParts(d);
  return `${thaiDate(d)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * Automatic notifications are not sent 21:00-08:00 Thai time; a message that
 * falls in that window is moved to 08:00 the same or next morning.
 */
export function nextAllowedSendTime(now: Date, quietStartHour = 21, quietEndHour = 8): Date {
  const p = bangkokParts(now);
  if (p.hour >= quietEndHour && p.hour < quietStartHour) return now;
  const dayOffset = p.hour >= quietStartHour ? 1 : 0;
  // 08:00 Bangkok == 01:00 UTC
  return new Date(Date.UTC(p.year, p.month, p.day + dayOffset, quietEndHour) - BANGKOK_OFFSET_MS);
}
