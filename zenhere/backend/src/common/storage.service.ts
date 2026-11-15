import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { config } from '../config/config';
import { decrypt, encrypt } from './crypto';

/**
 * File storage on the server's disk, one folder per company/user.
 * Kept behind this small interface so it can move to a NAS share or S3 later.
 * Every file is encrypted at rest; nothing is served from a public URL.
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(config().STORAGE_DIR);
  private readonly key = Buffer.from(config().FILE_ENCRYPTION_KEY, 'base64');

  private pathFor(key: string) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error(`invalid storage key: ${key}`);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encrypt(data, this.key), { flag: 'wx' });
  }

  async get(key: string): Promise<Buffer> {
    return decrypt(await readFile(this.pathFor(key)), this.key);
  }
}
