import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { newInviteCode, newUrlToken } from '../common/crypto';
import type { RequestMeta } from '../common/request-meta';
import { InjectDb, type Db } from '../db/database';
import type { Database, Membership, MembershipStatus, User } from '../db/types';
import { appLink } from '../notifications/links';
import { NotificationsService } from '../notifications/notifications.service';
import { CompanyAccessService } from './company-access.service';

export type ListKind = 'departments' | 'positions';

export interface JoinInput {
  code?: string;
  token?: string;
  employeeCode: string;
  departmentId?: string | null;
  positionId?: string | null;
}

export interface MembershipPatch {
  status?: 'approved' | 'rejected' | 'suspended';
  rejectReason?: string;
  employeeCode?: string;
  departmentId?: string | null;
  positionId?: string | null;
  canCreateDocuments?: boolean;
}

const ALLOWED_TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['suspended'],
  suspended: ['approved'],
  rejected: [],
};

export const normalizePhone = (p: string) => p.replace(/\D/g, '');

@Injectable()
export class CompaniesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: CompanyAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ invites (ADM-02, REG-04)

  /** Opens inside LINE (already logged in) when a LIFF app is set up. */
  inviteLink(token: string) {
    return appLink(`/join/${token}`);
  }

  async invite(user: User, companyId: string) {
    const { company } = await this.access.requireAdmin(user, companyId);
    return { code: company.invite_code, link: this.inviteLink(company.invite_token), rotatedAt: company.invite_rotated_at };
  }

  /** New code and link; the old ones stop working immediately. */
  async rotateInvite(user: User, companyId: string, meta: RequestMeta) {
    await this.access.requireAdmin(user, companyId);
    const fresh = await this.withUniqueInvite((code, token) =>
      this.db
        .updateTable('companies')
        .set({ invite_code: code, invite_token: token, invite_rotated_at: new Date(), updated_at: new Date() })
        .where('id', '=', companyId)
        .returning(['invite_code', 'invite_token', 'invite_rotated_at'])
        .executeTakeFirstOrThrow(),
    );
    await this.audit.log({ companyId, actor: user, action: 'company.invite_rotated', targetType: 'company', targetId: companyId, meta });
    return { code: fresh.invite_code, link: this.inviteLink(fresh.invite_token), rotatedAt: fresh.invite_rotated_at };
  }

  /** Retries on the (rare) unique collision of the 8-digit code. */
  async withUniqueInvite<T>(fn: (code: string, token: string) => Promise<T>): Promise<T> {
    for (let i = 0; i < 5; i++) {
      try {
        return await fn(newInviteCode(), newUrlToken());
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
      }
    }
    throw new Error('could not allocate a unique invite code');
  }

  async lookup(params: { code?: string; token?: string }) {
    const company = await this.findByInvite(params);
    const [departments, positions] = await Promise.all([this.activeList('departments', company.id), this.activeList('positions', company.id)]);
    return { companyId: company.id, name: company.name, departments, positions };
  }

  private async findByInvite({ code, token }: { code?: string; token?: string }) {
    if (!code && !token) throw new BadRequestException('กรุณากรอกรหัสเข้าร่วม');
    let q = this.db.selectFrom('companies').selectAll().where('status', '=', 'active');
    q = code ? q.where('invite_code', '=', code) : q.where('invite_token', '=', token!);
    const company = await q.executeTakeFirst();
    if (!company) throw new NotFoundException('รหัสหรือลิงก์เชิญไม่ถูกต้อง หรือถูกเปลี่ยนแล้ว');
    return company;
  }

  private activeList(kind: ListKind, companyId: string) {
    return this.db
      .selectFrom(kind)
      .select(['id', 'name'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .orderBy('name')
      .execute();
  }

  // ------------------------------------------------------------ joining (REG-02, REG-04, REG-05, ADM-07)

  async join(user: User, input: JoinInput, meta: RequestMeta) {
    const company = await this.findByInvite(input);
    const employeeCode = input.employeeCode.trim();
    await this.assertListItems(company.id, input.departmentId, input.positionId, true);

    const existing = await this.db
      .selectFrom('memberships')
      .selectAll()
      .where('company_id', '=', company.id)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (existing?.status === 'pending') throw new ConflictException('คุณส่งคำขอเข้าบริษัทนี้แล้ว กำลังรออนุมัติ');
    if (existing?.status === 'approved') throw new ConflictException('คุณเป็นสมาชิกบริษัทนี้อยู่แล้ว');
    if (existing?.status === 'suspended') throw new ForbiddenException('บัญชีของคุณในบริษัทนี้ถูกระงับ กรุณาติดต่อผู้ดูแล');

    // ADM-07: pre-imported employee with the same code and phone is approved straight away
    const imported = await this.db
      .selectFrom('employee_imports')
      .selectAll()
      .where('company_id', '=', company.id)
      .where(sql`lower(employee_code)`, '=', employeeCode.toLowerCase())
      .where('phone', '=', normalizePhone(user.phone ?? ''))
      .where('matched_membership_id', 'is', null)
      .executeTakeFirst();

    const values = {
      employee_code: employeeCode,
      department_id: input.departmentId ?? imported?.department_id ?? null,
      position_id: input.positionId ?? imported?.position_id ?? null,
      status: (imported ? 'approved' : 'pending') as MembershipStatus,
      join_method: (imported ? 'import' : input.code ? 'code' : 'link') as Membership['join_method'],
      can_create_documents: imported?.can_create_documents ?? false,
      requested_at: new Date(),
      decided_at: imported ? new Date() : null,
      decided_by: null,
      reject_reason: null,
      updated_at: new Date(),
    };

    const membership = await this.db.transaction().execute(async (trx) => {
      const row = await this.uniqueEmployeeCode(() =>
        existing
          ? trx.updateTable('memberships').set(values).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow()
          : trx.insertInto('memberships').values({ ...values, user_id: user.id, company_id: company.id }).returningAll().executeTakeFirstOrThrow(),
      );
      if (imported) {
        await trx.updateTable('employee_imports').set({ matched_membership_id: row.id }).where('id', '=', imported.id).execute();
        await this.notifications.enqueue(
          { userId: user.id, companyId: company.id, type: 'membership.approved', payload: { companyName: company.name, auto: true } },
          trx,
        );
      }
      await this.audit.log(
        {
          companyId: company.id,
          actor: user,
          action: imported ? 'membership.auto_approved_by_import' : 'membership.requested',
          targetType: 'membership',
          targetId: row.id,
          details: { employeeCode, via: values.join_method },
          meta,
        },
        trx,
      );
      return row;
    });
    return { id: membership.id, companyId: company.id, companyName: company.name, status: membership.status };
  }

  private async uniqueEmployeeCode<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if ((err as { code?: string; constraint?: string }).constraint === 'memberships_employee_code_uq') {
        throw new ConflictException('รหัสพนักงานนี้มีคนใช้แล้วในบริษัทนี้');
      }
      throw err;
    }
  }

  private async assertListItems(companyId: string, departmentId: string | null | undefined, positionId: string | null | undefined, requireWhenListExists: boolean) {
    for (const [kind, id, label] of [
      ['departments', departmentId, 'แผนก'],
      ['positions', positionId, 'ตำแหน่ง'],
    ] as const) {
      if (id) {
        const found = await this.db.selectFrom(kind).select('id').where('id', '=', id).where('company_id', '=', companyId).where('is_active', '=', true).executeTakeFirst();
        if (!found) throw new BadRequestException(`${label}ที่เลือกไม่อยู่ในรายการของบริษัท`);
      } else if (requireWhenListExists) {
        const any = await this.db.selectFrom(kind).select('id').where('company_id', '=', companyId).where('is_active', '=', true).executeTakeFirst();
        if (any) throw new BadRequestException(`กรุณาเลือก${label}`);
      }
    }
  }

  // ------------------------------------------------------------ members (ADM-04, ADM-06)

  async members(user: User, companyId: string, filter: { status?: MembershipStatus; q?: string; notFriend?: boolean }) {
    await this.access.requireAdmin(user, companyId);
    let q = this.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .leftJoin('departments as d', 'd.id', 'm.department_id')
      .leftJoin('positions as p', 'p.id', 'm.position_id')
      .select([
        'm.id',
        'm.user_id as userId',
        'u.first_name as firstName',
        'u.last_name as lastName',
        'u.nickname',
        'u.phone',
        'u.email',
        'u.line_display_name as lineDisplayName',
        'u.line_picture_url as linePictureUrl',
        'u.is_oa_friend as isOaFriend',
        'm.employee_code as employeeCode',
        'm.department_id as departmentId',
        'd.name as departmentName',
        'm.position_id as positionId',
        'p.name as positionName',
        'm.role',
        'm.status',
        'm.can_create_documents as canCreateDocuments',
        'm.join_method as joinMethod',
        'm.requested_at as requestedAt',
        'm.decided_at as decidedAt',
        'm.reject_reason as rejectReason',
      ])
      .where('m.company_id', '=', companyId);
    if (filter.status) q = q.where('m.status', '=', filter.status);
    if (filter.notFriend) q = q.where('u.is_oa_friend', '=', false);
    if (filter.q) {
      const like = `%${filter.q.trim()}%`;
      q = q.where((eb) =>
        eb.or([
          eb('u.first_name', 'ilike', like),
          eb('u.last_name', 'ilike', like),
          eb('u.nickname', 'ilike', like),
          eb('u.phone', 'ilike', like),
          eb('m.employee_code', 'ilike', like),
          eb('d.name', 'ilike', like),
        ]),
      );
    }
    return q.orderBy(sql`CASE m.status WHEN 'pending' THEN 0 ELSE 1 END`).orderBy('m.requested_at', 'desc').limit(500).execute();
  }

  async updateMembership(user: User, membershipId: string, patch: MembershipPatch, meta: RequestMeta) {
    const m = await this.db.selectFrom('memberships').selectAll().where('id', '=', membershipId).executeTakeFirst();
    if (!m) throw new NotFoundException('ไม่พบสมาชิก');
    const { company } = await this.access.requireAdmin(user, m.company_id);
    await this.assertListItems(m.company_id, patch.departmentId, patch.positionId, false);

    if (patch.status && patch.status !== m.status) {
      if (!ALLOWED_TRANSITIONS[m.status].includes(patch.status)) {
        throw new BadRequestException(`เปลี่ยนสถานะจาก ${m.status} เป็น ${patch.status} ไม่ได้`);
      }
      if (patch.status === 'rejected' && !patch.rejectReason?.trim()) throw new BadRequestException('กรุณาใส่เหตุผลที่ปฏิเสธ');
      if (patch.status === 'suspended' && m.user_id === user.id) throw new BadRequestException('ระงับบัญชีตัวเองไม่ได้');
    }

    const updated = await this.db.transaction().execute(async (trx) => {
      // lock the company's admin rows so two admins cannot suspend each other at the same moment
      if (patch.status === 'suspended' && m.role === 'admin') await this.assertNotLastAdmin(trx, m);

      const set: Record<string, unknown> = { updated_at: new Date() };
      if (patch.employeeCode !== undefined) set.employee_code = patch.employeeCode.trim();
      if (patch.departmentId !== undefined) set.department_id = patch.departmentId;
      if (patch.positionId !== undefined) set.position_id = patch.positionId;
      if (patch.canCreateDocuments !== undefined) set.can_create_documents = patch.canCreateDocuments;
      if (patch.status && patch.status !== m.status) {
        set.status = patch.status;
        set.decided_at = new Date();
        set.decided_by = user.id;
        set.reject_reason = patch.status === 'rejected' ? patch.rejectReason!.trim() : null;
      }
      const row = await this.uniqueEmployeeCode(() =>
        trx.updateTable('memberships').set(set).where('id', '=', m.id).returningAll().executeTakeFirstOrThrow(),
      );

      const changes = diff(m, row, ['employee_code', 'department_id', 'position_id', 'can_create_documents', 'status', 'reject_reason']);
      if (Object.keys(changes).length) {
        await this.audit.log(
          { companyId: m.company_id, actor: user, action: actionFor(m, row), targetType: 'membership', targetId: m.id, details: { userId: m.user_id, changes }, meta },
          trx,
        );
      }
      // ADM-04: documents waiting on a suspended person go back to their creators and the admins
      if (row.status === 'suspended' && m.status !== 'suspended') {
        const stuck = await trx
          .selectFrom('document_signers as s')
          .innerJoin('documents as d', 'd.id', 's.document_id')
          .select(['d.id', 'd.title', 'd.created_by', 's.display_name'])
          .where('s.user_id', '=', m.user_id)
          .where('d.company_id', '=', m.company_id)
          .where('d.status', '=', 'pending')
          .where('s.status', 'in', ['pending', 'waiting'])
          .execute();
        if (stuck.length) {
          const admins = await trx.selectFrom('memberships').select('user_id').where('company_id', '=', m.company_id).where('role', '=', 'admin').where('status', '=', 'approved').execute();
          for (const d of stuck) {
            for (const to of new Set([d.created_by, ...admins.map((a) => a.user_id)])) {
              await this.notifications.enqueue({ userId: to, companyId: m.company_id, type: 'signer.suspended', payload: { documentId: d.id, title: d.title, signerName: d.display_name } }, trx);
            }
          }
        }
      }
      // REG-06: tell the applicant on LINE
      if (m.status === 'pending' && row.status === 'approved') {
        await this.notifications.enqueue({ userId: m.user_id, companyId: m.company_id, type: 'membership.approved', payload: { companyName: company.name } }, trx);
      } else if (m.status === 'pending' && row.status === 'rejected') {
        await this.notifications.enqueue(
          { userId: m.user_id, companyId: m.company_id, type: 'membership.rejected', payload: { companyName: company.name, reason: row.reject_reason } },
          trx,
        );
      }
      return row;
    });
    return { id: updated.id, status: updated.status };
  }

  /** ADM-03: every company keeps at least one active admin. */
  async assertNotLastAdmin(trx: Transaction<Database>, m: Pick<Membership, 'id' | 'company_id'>) {
    const admins = await trx
      .selectFrom('memberships')
      .select('id')
      .where('company_id', '=', m.company_id)
      .where('role', '=', 'admin')
      .where('status', '=', 'approved')
      .forUpdate()
      .execute();
    if (admins.filter((a) => a.id !== m.id).length === 0) {
      throw new BadRequestException('บริษัทต้องมีผู้ดูแลอย่างน้อย 1 คน');
    }
  }

  // ------------------------------------------------------------ departments & positions (ADM-05)

  async list(user: User, companyId: string, kind: ListKind) {
    await this.access.requireMember(user, companyId);
    return this.db
      .selectFrom(kind)
      .select(['id', 'name', 'sort_order as sortOrder', 'is_active as isActive'])
      .where('company_id', '=', companyId)
      .orderBy('sort_order')
      .orderBy('name')
      .execute();
  }

  async createListItem(user: User, companyId: string, kind: ListKind, input: { name: string; sortOrder?: number }, meta: RequestMeta) {
    await this.access.requireAdmin(user, companyId);
    try {
      const row = await this.db
        .insertInto(kind)
        .values({ company_id: companyId, name: input.name.trim(), sort_order: input.sortOrder ?? 0 })
        .returning(['id', 'name', 'sort_order as sortOrder', 'is_active as isActive'])
        .executeTakeFirstOrThrow();
      await this.audit.log({ companyId, actor: user, action: `${kind}.created`, targetType: kind, targetId: row.id, details: { name: row.name }, meta });
      return row;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException('มีชื่อนี้อยู่แล้ว');
      throw err;
    }
  }

  async updateListItem(user: User, companyId: string, kind: ListKind, id: string, input: { name?: string; sortOrder?: number; isActive?: boolean }, meta: RequestMeta) {
    await this.access.requireAdmin(user, companyId);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.sortOrder !== undefined) set.sort_order = input.sortOrder;
    if (input.isActive !== undefined) set.is_active = input.isActive;
    if (!Object.keys(set).length) throw new BadRequestException('ไม่มีข้อมูลที่จะแก้ไข');
    try {
      const row = await this.db
        .updateTable(kind)
        .set(set)
        .where('id', '=', id)
        .where('company_id', '=', companyId)
        .returning(['id', 'name', 'sort_order as sortOrder', 'is_active as isActive'])
        .executeTakeFirst();
      if (!row) throw new NotFoundException();
      await this.audit.log({ companyId, actor: user, action: `${kind}.updated`, targetType: kind, targetId: id, details: input, meta });
      return row;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException('มีชื่อนี้อยู่แล้ว');
      throw err;
    }
  }

  // ------------------------------------------------------------ dashboard & log (ADM-08, ADM-09)

  async dashboard(user: User, companyId: string) {
    const { company } = await this.access.requireAdmin(user, companyId);
    const byStatus = await this.db
      .selectFrom('memberships')
      .select(['status', sql<number>`count(*)::int`.as('count')])
      .where('company_id', '=', companyId)
      .groupBy('status')
      .execute();
    const notFriend = await this.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('m.company_id', '=', companyId)
      .where('m.status', '=', 'approved')
      .where('u.is_oa_friend', '=', false)
      .executeTakeFirstOrThrow();
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.count]));
    const docs = await this.db
      .selectFrom('documents')
      .select([
        sql<number>`count(*) FILTER (WHERE status = 'pending')::int`.as('pending'),
        sql<number>`count(*) FILTER (WHERE status = 'completed')::int`.as('completed'),
        sql<number>`count(*) FILTER (WHERE status = 'declined')::int`.as('declined'),
        sql<number>`count(*) FILTER (WHERE status = 'voided' AND sent_at IS NOT NULL)::int`.as('voided'),
        sql<number>`count(*) FILTER (WHERE status = 'pending' AND due_at < now())::int`.as('overdue'),
      ])
      .where('company_id', '=', companyId)
      .executeTakeFirstOrThrow();
    const topPending = await this.db
      .selectFrom('document_signers as s')
      .innerJoin('documents as d', 'd.id', 's.document_id')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['u.id as userId', sql<string>`coalesce(u.first_name || ' ' || u.last_name, u.line_display_name)`.as('name'), 'u.is_oa_friend as isOaFriend', sql<number>`count(*)::int`.as('count')])
      .where('d.company_id', '=', companyId)
      .where('d.status', '=', 'pending')
      .where('s.status', '=', 'pending')
      .groupBy(['u.id'])
      .orderBy(sql`count(*)`, 'desc')
      .limit(5)
      .execute();
    const certificate = await this.db
      .selectFrom('company_certificates')
      .select(['subject', 'not_after as notAfter'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    return {
      documents: docs,
      topPendingSigners: topPending,
      certificate: certificate ?? null,
      company: { id: company.id, name: company.name, status: company.status },
      members: {
        pending: counts.pending ?? 0,
        approved: counts.approved ?? 0,
        suspended: counts.suspended ?? 0,
        rejected: counts.rejected ?? 0,
      },
      approvedNotOaFriend: notFriend.count,
    };
  }

  async auditLog(user: User, companyId: string, filter: AuditFilter) {
    await this.access.requireAdmin(user, companyId);
    return queryAudit(this.db, { ...filter, companyId });
  }
}

export interface AuditFilter {
  companyId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
}

export async function queryAudit(db: Db, f: AuditFilter) {
  const pageSize = 50;
  let q = db
    .selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.actor_user_id')
    .leftJoin('companies as c', 'c.id', 'a.company_id')
    .select([
      'a.id',
      'a.created_at as createdAt',
      'a.company_id as companyId',
      'c.name as companyName',
      'a.actor_user_id as actorId',
      sql<string>`coalesce(u.first_name || ' ' || u.last_name, u.line_display_name, 'ระบบ')`.as('actorName'),
      'a.action',
      'a.target_type as targetType',
      'a.target_id as targetId',
      'a.details',
      'a.ip',
    ]);
  if (f.companyId) q = q.where('a.company_id', '=', f.companyId);
  if (f.actorId) q = q.where('a.actor_user_id', '=', f.actorId);
  if (f.action) q = q.where('a.action', 'like', `${f.action}%`);
  if (f.from) q = q.where('a.created_at', '>=', new Date(f.from));
  if (f.to) q = q.where('a.created_at', '<', new Date(f.to));
  const page = Math.max(1, f.page ?? 1);
  const rows = await q.orderBy('a.id', 'desc').limit(pageSize + 1).offset((page - 1) * pageSize).execute();
  return { page, hasMore: rows.length > pageSize, items: rows.slice(0, pageSize) };
}

function diff<T extends Record<string, unknown>>(a: T, b: T, keys: (keyof T)[]) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) if (a[k] !== b[k]) out[k as string] = { from: a[k], to: b[k] };
  return out;
}

function actionFor(before: Membership, after: Membership) {
  if (before.status !== after.status) {
    if (after.status === 'approved') return before.status === 'suspended' ? 'membership.reactivated' : 'membership.approved';
    return `membership.${after.status}`;
  }
  if (before.can_create_documents !== after.can_create_documents) {
    return after.can_create_documents ? 'membership.create_permission_granted' : 'membership.create_permission_revoked';
  }
  return 'membership.updated';
}
