import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDb, type Db } from '../db/database';
import type { Company, Membership, User } from '../db/types';

export interface CompanyContext {
  company: Company;
  membership: Membership | null; // null when a Super Admin acts without being a member
}

@Injectable()
export class CompanyAccessService {
  constructor(@InjectDb() private readonly db: Db) {}

  async company(companyId: string): Promise<Company> {
    const company = await this.db.selectFrom('companies').selectAll().where('id', '=', companyId).executeTakeFirst();
    if (!company) throw new NotFoundException('ไม่พบบริษัท');
    return company;
  }

  /** Approved member of an active company. */
  async requireMember(user: User, companyId: string): Promise<CompanyContext> {
    const company = await this.company(companyId);
    const membership = await this.db
      .selectFrom('memberships')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (membership?.status === 'approved' && company.status === 'active') return { company, membership };
    if (user.is_super_admin) return { company, membership: membership ?? null };
    if (company.status !== 'active') throw new ForbiddenException('บริษัทนี้ถูกระงับการใช้งาน');
    throw new ForbiddenException('คุณไม่ได้เป็นสมาชิกของบริษัทนี้');
  }

  /** Company Admin of an active company, or any Super Admin (ADM-01..ADM-11). */
  async requireAdmin(user: User, companyId: string): Promise<CompanyContext> {
    const ctx = await this.requireMember(user, companyId);
    if (user.is_super_admin || ctx.membership?.role === 'admin') return ctx;
    throw new ForbiddenException('เฉพาะผู้ดูแลบริษัท');
  }
}
