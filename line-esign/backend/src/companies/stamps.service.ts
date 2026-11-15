import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { StorageService } from '../common/storage.service';
import { InjectDb, type Db } from '../db/database';
import type { User } from '../db/types';
import { readPngInfo } from '../users/png';
import { CompanyAccessService } from './company-access.service';

/** ADM-10: company stamps. The image is cut out in the browser like a signature. */
@Injectable()
export class StampsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: CompanyAccessService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(user: User, companyId: string) {
    const { membership } = await this.access.requireMember(user, companyId);
    const isAdmin = user.is_super_admin || membership?.role === 'admin';
    let q = this.db
      .selectFrom('company_stamps as st')
      .select([
        'st.id',
        'st.name',
        'st.is_active as isActive',
        'st.width',
        'st.height',
        'st.created_at as createdAt',
        sql<{ userId: string; firstName: string | null; lastName: string | null }[]>`coalesce((
          SELECT json_agg(json_build_object('userId', u.id, 'firstName', u.first_name, 'lastName', u.last_name))
          FROM company_stamp_users su JOIN users u ON u.id = su.user_id WHERE su.stamp_id = st.id), '[]'::json)`.as('users'),
      ])
      .where('st.company_id', '=', companyId);
    // people without permission never see the stamp in the list (ADM-10)
    if (!isAdmin) q = q.where('st.is_active', '=', true).where((eb) => eb.exists(eb.selectFrom('company_stamp_users as su').select('su.stamp_id').whereRef('su.stamp_id', '=', 'st.id').where('su.user_id', '=', user.id)));
    return q.orderBy('st.created_at').execute();
  }

  async create(user: User, companyId: string, name: string, png: Buffer, userIds: string[], meta: RequestMeta) {
    await this.access.requireAdmin(user, companyId);
    const info = readPngInfo(png);
    if (!info || (info.colorType !== 6 && info.colorType !== 4)) throw new BadRequestException('ตราประทับต้องเป็น PNG พื้นใส');
    if (png.length > 3 * 1024 * 1024) throw new BadRequestException('ไฟล์ตราใหญ่เกิน 3 MB');
    await this.checkMembers(companyId, userIds);
    const id = randomUUID();
    const key = `companies/${companyId}/stamps/${id}.png.enc`;
    await this.storage.put(key, png);
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('company_stamps').values({ id, company_id: companyId, name: name.trim(), storage_key: key, width: info.width, height: info.height, created_by: user.id }).execute();
      if (userIds.length) await trx.insertInto('company_stamp_users').values(userIds.map((u) => ({ stamp_id: id, user_id: u }))).execute();
      await this.audit.log({ companyId, actor: user, action: 'stamp.created', targetType: 'stamp', targetId: id, details: { name, userIds }, meta }, trx);
    });
    return { id };
  }

  async update(user: User, companyId: string, id: string, patch: { name?: string; isActive?: boolean; userIds?: string[] }, meta: RequestMeta) {
    await this.access.requireAdmin(user, companyId);
    const stamp = await this.db.selectFrom('company_stamps').select('id').where('id', '=', id).where('company_id', '=', companyId).executeTakeFirst();
    if (!stamp) throw new NotFoundException('ไม่พบตราประทับ');
    if (patch.userIds) await this.checkMembers(companyId, patch.userIds);
    await this.db.transaction().execute(async (trx) => {
      const set: Record<string, unknown> = {};
      if (patch.name !== undefined) set.name = patch.name.trim();
      if (patch.isActive !== undefined) set.is_active = patch.isActive;
      if (Object.keys(set).length) await trx.updateTable('company_stamps').set(set).where('id', '=', id).execute();
      if (patch.userIds) {
        await trx.deleteFrom('company_stamp_users').where('stamp_id', '=', id).execute();
        if (patch.userIds.length) await trx.insertInto('company_stamp_users').values(patch.userIds.map((u) => ({ stamp_id: id, user_id: u }))).execute();
      }
      await this.audit.log({ companyId, actor: user, action: 'stamp.updated', targetType: 'stamp', targetId: id, details: patch, meta }, trx);
    });
    return { ok: true };
  }

  async image(user: User, companyId: string, id: string) {
    const { membership } = await this.access.requireMember(user, companyId);
    const stamp = await this.db.selectFrom('company_stamps').select(['storage_key']).where('id', '=', id).where('company_id', '=', companyId).executeTakeFirst();
    if (!stamp) throw new NotFoundException();
    const isAdmin = user.is_super_admin || membership?.role === 'admin';
    if (!isAdmin) {
      const allowed = await this.db.selectFrom('company_stamp_users').select('stamp_id').where('stamp_id', '=', id).where('user_id', '=', user.id).executeTakeFirst();
      if (!allowed) throw new ForbiddenException();
    }
    return this.storage.get(stamp.storage_key);
  }

  private async checkMembers(companyId: string, userIds: string[]) {
    if (!userIds.length) return;
    const rows = await this.db.selectFrom('memberships').select('user_id').where('company_id', '=', companyId).where('status', '=', 'approved').where('user_id', 'in', userIds).execute();
    if (rows.length !== new Set(userIds).size) throw new BadRequestException('ผู้มีสิทธิ์ใช้ตราต้องเป็นพนักงานที่อนุมัติแล้ว');
  }
}
