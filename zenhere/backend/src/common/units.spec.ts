import { randomBytes } from 'node:crypto';
import { isValidThaiTaxId } from '../companies/thai-tax-id';
import { decrypt, encrypt, newInviteCode } from './crypto';
import { nextAllowedSendTime, thaiDate, thaiDateTime } from './thai-time';

describe('thai time', () => {
  it('formats Buddhist-era dates in Bangkok time', () => {
    expect(thaiDate(new Date('2026-11-15T03:00:00Z'))).toBe('15 พ.ย. 2569');
    // 18:30 UTC is already the next day in Bangkok
    expect(thaiDateTime(new Date('2026-11-15T18:30:00Z'))).toBe('16 พ.ย. 2569 01:30');
  });

  it('moves automatic messages out of 21:00-08:00', () => {
    const at = (iso: string) => nextAllowedSendTime(new Date(iso)).toISOString();
    expect(at('2026-11-15T05:00:00Z')).toBe('2026-11-15T05:00:00.000Z'); // 12:00 BKK: now
    expect(at('2026-11-15T14:30:00Z')).toBe('2026-11-16T01:00:00.000Z'); // 21:30 BKK -> 08:00 next day
    expect(at('2026-11-15T20:00:00Z')).toBe('2026-11-16T01:00:00.000Z'); // 03:00 BKK -> 08:00 same day
    expect(at('2026-11-16T00:59:00Z')).toBe('2026-11-16T01:00:00.000Z'); // 07:59 BKK
    expect(at('2026-11-16T01:00:00Z')).toBe('2026-11-16T01:00:00.000Z'); // 08:00 BKK
  });
});

describe('crypto', () => {
  it('round-trips AES-256-GCM and detects tampering', () => {
    const key = randomBytes(32);
    const data = Buffer.from('ลายเซ็น');
    const blob = encrypt(data, key);
    expect(decrypt(blob, key).toString()).toBe('ลายเซ็น');
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob, key)).toThrow();
  });

  it('makes 8-digit invite codes', () => {
    for (let i = 0; i < 100; i++) expect(newInviteCode()).toMatch(/^[1-9]\d{7}$/);
  });
});

describe('thai tax id', () => {
  it('checks the mod-11 digit', () => {
    expect(isValidThaiTaxId('0105556000017')).toBe(true);
    expect(isValidThaiTaxId('0105556000018')).toBe(false);
    expect(isValidThaiTaxId('12345')).toBe(false);
  });
});
