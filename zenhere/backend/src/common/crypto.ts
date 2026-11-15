import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';

const MAGIC = Buffer.from('ESG1');

/** AES-256-GCM. Layout: "ESG1" | iv(12) | tag(16) | ciphertext */
export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('not an encrypted blob');
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]);
}

export const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** 8-digit numeric join code (REG-04). Never starts with 0 so it survives spreadsheets. */
export const newInviteCode = () => String(randomInt(10_000_000, 100_000_000));

export const newUrlToken = (bytes = 18) => randomBytes(bytes).toString('base64url');
