import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { RequestMeta } from '../common/request-meta';
import { InjectDb, type Db } from '../db/database';
import type { Database, User } from '../db/types';

export interface DocEvent {
  documentId: string;
  type: string;
  actor?: Pick<User, 'id' | 'line_user_id'> | null;
  signerId?: string | null;
  details?: Record<string, unknown>;
  meta?: RequestMeta;
}

/** SGN-06: every document event, with time, IP, user agent and LINE userId. Append-only table. */
@Injectable()
export class DocumentEventsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async log(e: DocEvent, trx?: Transaction<Database>) {
    await (trx ?? this.db)
      .insertInto('document_events')
      .values({
        document_id: e.documentId,
        type: e.type,
        actor_user_id: e.actor?.id ?? null,
        actor_line_user_id: e.actor?.line_user_id ?? null,
        signer_id: e.signerId ?? null,
        details: JSON.stringify(e.details ?? {}),
        ip: e.meta?.ip ?? null,
        user_agent: e.meta?.userAgent ?? null,
      })
      .execute();
  }
}
