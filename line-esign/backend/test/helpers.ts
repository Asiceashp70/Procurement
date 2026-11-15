import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { loadConfig, setConfigForTests } from '../src/config/config';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://esign:esign_dev@localhost:5432/postgres';
// one database per Jest worker so suites can run in parallel
export const TEST_DB = `esign_test_${process.env.JEST_WORKER_ID ?? '1'}`;
export const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
export const ORIGIN = 'http://localhost:5173';
export const SUPER_ADMIN_LINE_ID = 'U' + 'a'.repeat(32);

export async function resetDatabase() {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${TEST_DB}`);
  await c.end();
}

export function useTestConfig(overrides: Record<string, string> = {}) {
  setConfigForTests(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB_URL,
      APP_ORIGIN: ORIGIN,
      API_BASE_URL: `${ORIGIN}/api`,
      JWT_SECRET: randomBytes(32).toString('hex'),
      FILE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      STORAGE_DIR: mkdtempSync(join(tmpdir(), 'esign-test-')),
      DEV_LOGIN_ENABLED: 'true',
      LINE_PUSH_ENABLED: 'false',
      LINE_MESSAGING_CHANNEL_SECRET: 'test-channel-secret',
      SUPER_ADMIN_LINE_USER_IDS: SUPER_ADMIN_LINE_ID,
      ...overrides,
    }),
  );
}

/** A minimal RGBA PNG (color type 6), like the browser produces after the cutout step. */
export function makePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      if ((x + y) % 7 === 0) raw.writeUInt32BE(0x1a1a8cff, o); // some blue "ink"
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let lineIdCounter = 1;
export const nextLineId = () => 'U' + (lineIdCounter++).toString(16).padStart(32, '0');
