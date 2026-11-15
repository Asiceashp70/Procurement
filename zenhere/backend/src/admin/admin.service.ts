import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { CompaniesService, queryAudit, type AuditFilter } from '../companies/companies.service';
import { isValidThaiTaxId } from '../companies/thai-tax-id';
import { InjectDb, type Db } from '../db/database';
import type { User } from '../db/types';
import { NotificationsService } from '../notifications/notifications.service';

export interface CompanyInput {
  name: string;
  taxId?: string | null;
  address?: string | null;
}

/** Super Admin back office (ADM-01, ADM-03). The controller is restricted with @SuperAdminOnly. */
@Injectable()
export class AdminService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async overview() {
    const [companies, users, quota, sentThisMonth] = await Promise.all([
      this.db.selectFrom('companies').select(['status', sql<number>`count(*)::int`.as('n')]).groupBy('status').execute(),
      this.db.selectFrom('users').select(sql<number>`count(*) FILTER (WHERE registered_at IS NOT NULL)::int`.as('n')).executeTakeFirstOrThrow(),
      this.notifications.quota(),
      this.notifications.sentThisMonth(),
    ]);
    return {
      companies: Object.fromEntries(companies.map((c) => [c.status, c.n])),
      registeredUsers: users.n,
      lineMessages: { sentThisMonth, quota },
    };
  }

  listCompanies(filter: { q?: string; status?: string }) {
    let q = this.db
      .selectFrom('companies as c')
      .select([
        'c.id',
        'c.name',
        'c.tax_id as taxId',
        'c.address',
        'c.status',
        'c.created_at as createdAt',
        sql<number>`(SELECT count(*) FROM memberships m WHERE m.company_id = c.id AND m.status = 'approved')::int`.as('memberCount'),
        sql<number>`(SELECT count(*) FROM memberships m WHERE m.company_id = c.id AND m.status = 'pending')::int`.as('pendingCount'),
        sql<{ userId: string; name: string }[]>`coalesce((
          SELECT json_agg(json_build_object('userId', u.id, 'name', coalesce(u.first_name || ' ' || u.last_name, u.line_display_name)))
          FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.company_id = c.id AND m.role = 'admin' AND m.status = 'approved'), '[]'::json)`.as('admins'),
      ]);
    if (filter.status === 'active' || filter.status === 'suspended') q = q.where('c.status', '=', filter.status);
    if (filter.q) q = q.where((eb) => eb.or([eb('c.name', 'ilike', `%${filter.q}%`), eb('c.tax_id', 'like', `%${filter.q}%`)]));
    return q.orderBy('c.name').execute();
  }

  async createCompany(user: User, input: CompanyInput, meta: RequestMeta) {
    this.checkTaxId(input.taxId);
    const company = await this.companies.withUniqueInvite((code, token) =>
      this.db
        .insertInto('companies')
        .values({
          name: input.name.trim(),
          tax_id: input.taxId || null,
          address: input.address?.trim() || null,
          invite_code: code,
          invite_token: token,
          settings: JSON.stringify({ reminderHoursBeforeDue: 24 }),
          created_by: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    await this.audit.log({ companyId: company.id, actor: user, action: 'company.created', targetType: 'company', targetId: company.id, details: input as unknown as Record<string, unknown>, meta });
    return { id: company.id, name: company.name, status: company.status };
  }

  /** ADM-01: a suspended company keeps all its data; members just cannot use it. */
  async updateCompany(user: User, id: string, input: Partial<CompanyInput> & { status?: 'active' | 'suspended' }, meta: RequestMeta) {
    if (input.taxId !== undefined) this.checkTaxId(input.taxId);
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.taxId !== undefined) set.tax_id = input.taxId || null;
    if (input.address !== undefined) set.address = input.address?.trim() || null;
    if (input.status !== undefined) set.status = input.status;
    const before = await this.db.selectFrom('companies').select(['status']).where('id', '=', id).executeTakeFirst();
    if (!before) throw new NotFoundException('ไม่พบบริษัท');
    await this.db.updateTable('companies').set(set).where('id', '=', id).execute();
    const action = input.status && input.status !== before.status ? (input.status === 'suspended' ? 'company.suspended' : 'company.reactivated') : 'company.updated';
    await this.audit.log({ companyId: id, actor: user, action, targetType: 'company', targetId: id, details: input, meta });
    return { ok: true };
  }

  /** ADM-03: any registered user can be made a Company Admin; they become an approved member. */
  async appointAdmin(user: User, companyId: string, userId: string, meta: RequestMeta) {
    const target = await this.db.selectFrom('users').select(['id', 'registered_at']).where('id', '=', userId).executeTakeFirst();
    if (!target) throw new NotFoundException('ไม่พบผู้ใช้');
    if (!target.registered_at) throw new BadRequestException('ผู้ใช้นี้ยังลงทะเบียนไม่ครบ');
    await this.db.selectFrom('companies').select('id').where('id', '=', companyId).executeTakeFirstOrThrow();
    const m = await this.db
      .insertInto('memberships')
      .values({ user_id: userId, company_id: companyId, role: 'admin', status: 'approved', can_create_documents: true, join_method: 'appointed', decided_at: new Date(), decided_by: user.id })
      .onConflict((oc) =>
        oc.columns(['user_id', 'company_id']).doUpdateSet({ role: 'admin', status: 'approved', can_create_documents: true, decided_at: new Date(), decided_by: user.id, reject_reason: null, updated_at: new Date() }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit.log({ companyId, actor: user, action: 'company_admin.appointed', targetType: 'membership', targetId: m.id, details: { userId }, meta });
    return { membershipId: m.id };
  }

  async removeAdmin(user: User, companyId: string, userId: string, meta: RequestMeta) {
    return this.db.transaction().execute(async (trx) => {
      const m = await trx
        .selectFrom('memberships')
        .selectAll()
        .where('company_id', '=', companyId)
        .where('user_id', '=', userId)
        .where('role', '=', 'admin')
        .executeTakeFirst();
      if (!m) throw new NotFoundException('ผู้ใช้นี้ไม่ได้เป็นผู้ดูแลบริษัทนี้');
      if (m.status === 'approved') await this.companies.assertNotLastAdmin(trx, m);
      await trx.updateTable('memberships').set({ role: 'member', updated_at: new Date() }).where('id', '=', m.id).execute();
      await this.audit.log({ companyId, actor: user, action: 'company_admin.removed', targetType: 'membership', targetId: m.id, details: { userId }, meta }, trx);
      return { ok: true };
    });
  }

  searchUsers(q: string) {
    const like = `%${q.trim()}%`;
    return this.db
      .selectFrom('users')
      .select(['id', 'first_name as firstName', 'last_name as lastName', 'line_display_name as lineDisplayName', 'phone', 'email', 'is_super_admin as isSuperAdmin'])
      .where('registered_at', 'is not', null)
      .where((eb) =>
        eb.or([eb('first_name', 'ilike', like), eb('last_name', 'ilike', like), eb('line_display_name', 'ilike', like), eb('phone', 'like', like), eb('email', 'ilike', like)]),
      )
      .orderBy('first_name')
      .limit(20)
      .execute();
  }

  auditLog(filter: AuditFilter) {
    return queryAudit(this.db, filter);
  }

  private checkTaxId(taxId: string | null | undefined) {
    if (taxId && !isValidThaiTaxId(taxId)) throw new BadRequestException('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง');
  }
}

