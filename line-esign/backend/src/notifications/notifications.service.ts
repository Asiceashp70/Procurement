import { Injectable, OnModuleInit } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { nextAllowedSendTime } from '../common/thai-time';
import { InjectDb, type Db } from '../db/database';
import type { Database } from '../db/types';
import { JobsService, PermanentJobError } from '../jobs/jobs.service';
import { LinePushService } from './line-push.service';
import { buildMessages } from './templates';

export interface NotifyInput {
  userId: string;
  companyId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  /**
   * Scheduled/automatic messages (reminders, overdue, certificate expiry) wait
   * until 08:00 when they fall in 21:00-08:00. Replies to a person's action
   * (approval result, "it's your turn") go out immediately.
   */
  respectQuietHours?: boolean;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly line: LinePushService,
  ) {}

  onModuleInit() {
    this.jobs.register('line.push', (p) => this.deliver(String(p.notificationId)));
    this.jobs.register('line.push:failed', async (p) => {
      await this.db
        .updateTable('notifications')
        .set({ status: 'failed', last_error: String(p.error).slice(0, 2000) })
        .where('id', '=', String(p.notificationId))
        .execute();
    });
  }

  /** Records the message and queues delivery, inside the caller's transaction when given. */
  async enqueue(input: NotifyInput, trx?: Transaction<Database>) {
    const db = trx ?? this.db;
    const scheduledAt = input.respectQuietHours ? nextAllowedSendTime(new Date()) : new Date();
    const n = await db
      .insertInto('notifications')
      .values({
        user_id: input.userId,
        company_id: input.companyId ?? null,
        type: input.type,
        payload: JSON.stringify(input.payload),
        scheduled_at: scheduledAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.jobs.enqueue('line.push', { notificationId: n.id }, scheduledAt, trx);
    return n.id;
  }

  private async deliver(notificationId: string) {
    const n = await this.db
      .selectFrom('notifications as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select(['n.id', 'n.type', 'n.payload', 'n.status', 'n.retry_key', 'u.line_user_id'])
      .where('n.id', '=', notificationId)
      .executeTakeFirst();
    if (!n) throw new PermanentJobError(`notification ${notificationId} not found`);
    if (n.status === 'sent') return;

    await this.db.updateTable('notifications').set({ attempts: sql`attempts + 1` }).where('id', '=', n.id).execute();
    try {
      const { requestId } = await this.line.push(n.line_user_id, buildMessages(n.type, n.payload), n.retry_key);
      await this.db
        .updateTable('notifications')
        .set({ status: 'sent', sent_at: new Date(), line_request_id: requestId, last_error: null })
        .where('id', '=', n.id)
        .execute();
    } catch (err) {
      await this.db
        .updateTable('notifications')
        .set({ last_error: String(err instanceof Error ? err.message : err).slice(0, 2000) })
        .where('id', '=', n.id)
        .execute();
      throw err;
    }
  }

  async sentThisMonth(): Promise<number> {
    const r = await this.db
      .selectFrom('notifications')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('status', '=', 'sent')
      .where('sent_at', '>=', sql<Date>`date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'`)
      .executeTakeFirstOrThrow();
    return r.n;
  }

  quota() {
    return this.line.quota();
  }
}
