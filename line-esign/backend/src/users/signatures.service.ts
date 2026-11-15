import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectDb, type Db } from '../db/database';
import type { User } from '../db/types';
import { StorageService } from '../common/storage.service';
import { readPngInfo } from './png';

export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 2000;

/**
 * SIG-05: the browser does all image processing and uploads only the final
 * transparent PNG. SIG-06: one active signature, older ones stay in history.
 */
@Injectable()
export class SignaturesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  async create(user: User, method: 'draw' | 'upload', png: Buffer) {
    if (png.length > MAX_SIGNATURE_BYTES) throw new BadRequestException('ไฟล์ลายเซ็นใหญ่เกิน 2 MB');
    const info = readPngInfo(png);
    if (!info) throw new BadRequestException('ลายเซ็นต้องเป็นไฟล์ PNG');
    if (info.colorType !== 6 && info.colorType !== 4) throw new BadRequestException('ลายเซ็นต้องเป็น PNG พื้นใส');
    if (info.width < 20 || info.height < 10 || info.width > MAX_SIDE || info.height > MAX_SIDE) {
      throw new BadRequestException('ขนาดรูปลายเซ็นไม่ถูกต้อง');
    }

    const id = randomUUID();
    const key = `users/${user.id}/signatures/${id}.png.enc`;
    await this.storage.put(key, png);
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('signatures')
        .set({ is_active: false, deactivated_at: new Date() })
        .where('user_id', '=', user.id)
        .where('is_active', '=', true)
        .execute();
      return trx
        .insertInto('signatures')
        .values({ id, user_id: user.id, method, storage_key: key, width: info.width, height: info.height, byte_size: png.length })
        .returning(['id', 'method', 'width', 'height', 'is_active as isActive', 'created_at as createdAt'])
        .executeTakeFirstOrThrow();
    });
  }

  list(user: User) {
    return this.db
      .selectFrom('signatures')
      .select(['id', 'method', 'width', 'height', 'is_active as isActive', 'created_at as createdAt', 'deactivated_at as deactivatedAt'])
      .where('user_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async image(user: User, id: string) {
    const sig = await this.db
      .selectFrom('signatures')
      .select(['storage_key'])
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (!sig) throw new NotFoundException();
    return this.storage.get(sig.storage_key);
  }
}
