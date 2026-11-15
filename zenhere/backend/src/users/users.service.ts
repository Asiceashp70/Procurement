import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service';
import type { LineIdentity } from '../auth/line-login.service';
import { config } from '../config/config';
import { InjectDb, type Db } from '../db/database';
import type { User } from '../db/types';
import type { RequestMeta } from '../common/request-meta';
import { currentConsent } from './consent';

export interface ProfileInput {
  firstName: string;
  lastName: string;
  nickname?: string | null;
  phone: string;
  email: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Creates the account on first LINE login. Super Admin comes only from server config, never from "first user". */
  async upsertFromLine(id: LineIdentity): Promise<User> {
    const isSuperAdmin = config().superAdminLineUserIds.has(id.lineUserId);
    const before = await this.db.selectFrom('users').select(['id', 'is_super_admin']).where('line_user_id', '=', id.lineUserId).executeTakeFirst();
    const user = await this.db
      .insertInto('users')
      .values({
        line_user_id: id.lineUserId,
        line_display_name: id.displayName,
        line_picture_url: id.pictureUrl,
        is_oa_friend: id.isFriend ?? false,
        oa_friend_checked_at: id.isFriend === null ? null : new Date(),
        is_super_admin: isSuperAdmin,
        last_login_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('line_user_id').doUpdateSet((eb) => ({
          line_display_name: eb.ref('excluded.line_display_name'),
          line_picture_url: eb.ref('excluded.line_picture_url'),
          is_super_admin: eb.ref('excluded.is_super_admin'),
          last_login_at: eb.ref('excluded.last_login_at'),
          ...(id.isFriend === null
            ? {}
            : { is_oa_friend: eb.ref('excluded.is_oa_friend'), oa_friend_checked_at: eb.ref('excluded.oa_friend_checked_at') }),
          updated_at: sql`now()`,
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    if ((before?.is_super_admin ?? false) !== isSuperAdmin) {
      await this.audit.log({
        actor: null,
        action: isSuperAdmin ? 'super_admin.granted_by_config' : 'super_admin.revoked_by_config',
        targetType: 'user',
        targetId: user.id,
      });
    }
    return user;
  }

  async setFriendStatus(lineUserId: string, isFriend: boolean) {
    await this.db
      .updateTable('users')
      .set({ is_oa_friend: isFriend, oa_friend_checked_at: new Date() })
      .where('line_user_id', '=', lineUserId)
      .execute();
  }

  async me(user: User) {
    const memberships = await this.db
      .selectFrom('memberships as m')
      .innerJoin('companies as c', 'c.id', 'm.company_id')
      .leftJoin('departments as d', 'd.id', 'm.department_id')
      .leftJoin('positions as p', 'p.id', 'm.position_id')
      .select([
        'm.id',
        'm.company_id as companyId',
        'c.name as companyName',
        'c.status as companyStatus',
        'm.employee_code as employeeCode',
        'm.department_id as departmentId',
        'd.name as departmentName',
        'm.position_id as positionId',
        'p.name as positionName',
        'm.role',
        'm.status',
        'm.can_create_documents as canCreateDocuments',
        'm.reject_reason as rejectReason',
        'm.requested_at as requestedAt',
      ])
      .where('m.user_id', '=', user.id)
      .orderBy('c.name')
      .execute();
    const activeSignature = await this.db
      .selectFrom('signatures')
      .select(['id', 'created_at as createdAt'])
      .where('user_id', '=', user.id)
      .where('is_active', '=', true)
      .executeTakeFirst();
    const lastConsent = await this.db
      .selectFrom('consents')
      .select(['consent_version'])
      .where('user_id', '=', user.id)
      .orderBy('accepted_at', 'desc')
      .executeTakeFirst();
    return {
      id: user.id,
      lineDisplayName: user.line_display_name,
      linePictureUrl: user.line_picture_url,
      firstName: user.first_name,
      lastName: user.last_name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      isOaFriend: user.is_oa_friend,
      isSuperAdmin: user.is_super_admin,
      registered: Boolean(user.registered_at),
      needsConsent: lastConsent?.consent_version !== currentConsent().version,
      activeSignature: activeSignature ?? null,
      memberships,
    };
  }

  /** REG-01, REG-03, REG-08: first-time form; needs a signature and the current PDPA consent. */
  async register(user: User, input: ProfileInput & { consentVersion: string }, meta: RequestMeta) {
    const consent = currentConsent();
    if (input.consentVersion !== consent.version) {
      throw new BadRequestException('ข้อความยินยอมมีการปรับปรุง กรุณาโหลดหน้าใหม่แล้วอ่านอีกครั้ง');
    }
    const hasSignature = await this.db
      .selectFrom('signatures')
      .select('id')
      .where('user_id', '=', user.id)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!hasSignature) throw new BadRequestException({ message: 'กรุณาตั้งลายเซ็นก่อนส่งลงทะเบียน', code: 'SIGNATURE_REQUIRED' });

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('consents')
        .values({ user_id: user.id, consent_version: consent.version, consent_sha256: consent.sha256, ip: meta.ip, user_agent: meta.userAgent })
        .execute();
      await trx
        .updateTable('users')
        .set({ ...this.profileColumns(input), registered_at: user.registered_at ?? new Date(), updated_at: new Date() })
        .where('id', '=', user.id)
        .execute();
    });
    return this.me(await this.reload(user.id));
  }

  /** REG-07 */
  async updateProfile(user: User, input: ProfileInput) {
    await this.db
      .updateTable('users')
      .set({ ...this.profileColumns(input), updated_at: new Date() })
      .where('id', '=', user.id)
      .execute();
    return this.me(await this.reload(user.id));
  }

  async acceptConsent(user: User, version: string, meta: RequestMeta) {
    const consent = currentConsent();
    if (version !== consent.version) throw new BadRequestException('ข้อความยินยอมมีการปรับปรุง กรุณาโหลดหน้าใหม่');
    await this.db
      .insertInto('consents')
      .values({ user_id: user.id, consent_version: consent.version, consent_sha256: consent.sha256, ip: meta.ip, user_agent: meta.userAgent })
      .execute();
    return { ok: true };
  }

  private profileColumns(input: ProfileInput) {
    return {
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      nickname: input.nickname?.trim() || null,
      phone: input.phone,
      email: input.email.trim().toLowerCase(),
    };
  }

  private reload(id: string) {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }
}
