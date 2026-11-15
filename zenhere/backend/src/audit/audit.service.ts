import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { InjectDb, type Db } from '../db/database';
import type { Database, User } from '../db/types';
import type { RequestMeta } from '../common/request-meta';

export interface AuditEntry {
  companyId?: string | null;
  actor?: Pick<User, 'id' | 'line_user_id'> | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  meta?: RequestMeta;
}

/** ADM-09: append-only log of admin actions (approvals, permission changes, opening other people's files). */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Db) {}

  async log(entry: AuditEntry, trx?: Transaction<Database>) {
    await (trx ?? this.db)
      .insertInto('audit_logs')
      .values({
        company_id: entry.companyId ?? null,
        actor_user_id: entry.actor?.id ?? null,
        actor_line_user_id: entry.actor?.line_user_id ?? null,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        details: JSON.stringify(entry.details ?? {}),
        ip: entry.meta?.ip ?? null,
        user_agent: entry.meta?.userAgent ?? null,
      })
      .execute();
  }
}
