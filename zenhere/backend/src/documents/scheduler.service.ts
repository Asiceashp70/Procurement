import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { config } from '../config/config';
import { InjectDb, type Db } from '../db/database';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentsService } from './documents.service';
import { FinalizeService } from './finalize.service';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * Timed notifications (PRD "การแจ้งเตือนผ่าน LINE"), all subject to the 21:00-08:00 quiet hours:
 *  - due soon: N hours before the due time (company setting, default 24)
 *  - overdue: every 24 hours, at most 3 times, to unsigned signers and the creator
 *  - certificate expiring: 30 and 7 days before
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(SchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly finalize: FinalizeService,
  ) {}

  onModuleInit() {
    if (!config().JOB_WORKER_ENABLED || config().NODE_ENV === 'test') return;
    this.timer = setInterval(() => this.runOnce().catch((err) => this.log.error(String(err))), 5 * 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()) {
    return {
      dueSoon: await this.dueSoon(now),
      overdue: await this.overdue(now),
      certificates: await this.certificates(now),
    };
  }

  private async dueSoon(now: Date) {
    const docs = await this.db
      .selectFrom('documents as d')
      .innerJoin('companies as c', 'c.id', 'd.company_id')
      .selectAll('d')
      .where('d.status', '=', 'pending')
      .where('d.due_soon_notified_at', 'is', null)
      .where('d.due_at', '>', now)
      .where(sql<boolean>`d.due_at - make_interval(hours => coalesce((c.settings->>'reminderHoursBeforeDue')::int, 24)) <= ${now}`)
      .execute();
    for (const doc of docs) {
      await this.db.transaction().execute(async (trx) => {
        const claimed = await trx.updateTable('documents').set({ due_soon_notified_at: now }).where('id', '=', doc.id).where('due_soon_notified_at', 'is', null).executeTakeFirst();
        if (!claimed.numUpdatedRows) return;
        const ctx = await this.documents.notifyContext(trx, doc);
        const pending = await trx.selectFrom('document_signers').select('user_id').where('document_id', '=', doc.id).where('status', '=', 'pending').execute();
        for (const s of pending) await this.notifications.enqueue({ userId: s.user_id, companyId: doc.company_id, type: 'doc.due_soon', payload: ctx, respectQuietHours: true }, trx);
      });
    }
    return docs.length;
  }

  private async overdue(now: Date) {
    const docs = await this.db
      .selectFrom('documents')
      .selectAll()
      .where('status', '=', 'pending')
      .where('due_at', '<', now)
      .where('overdue_notices_sent', '<', 3)
      .where((eb) => eb.or([eb('last_overdue_notice_at', 'is', null), eb('last_overdue_notice_at', '<=', new Date(now.getTime() - DAY + 5 * 60_000))]))
      .execute();
    for (const doc of docs) {
      await this.db.transaction().execute(async (trx) => {
        const claimed = await trx
          .updateTable('documents')
          .set({ overdue_notices_sent: sql`overdue_notices_sent + 1`, last_overdue_notice_at: now })
          .where('id', '=', doc.id)
          .where('overdue_notices_sent', '=', doc.overdue_notices_sent)
          .executeTakeFirst();
        if (!claimed.numUpdatedRows) return;
        const ctx = await this.documents.notifyContext(trx, doc);
        const unsigned = await trx.selectFrom('document_signers').select(['user_id', 'display_name', 'status']).where('document_id', '=', doc.id).where('status', 'in', ['pending', 'waiting']).execute();
        for (const s of unsigned.filter((u) => u.status === 'pending')) {
          await this.notifications.enqueue({ userId: s.user_id, companyId: doc.company_id, type: 'doc.overdue', payload: ctx, respectQuietHours: true }, trx);
        }
        await this.notifications.enqueue(
          { userId: doc.created_by, companyId: doc.company_id, type: 'doc.overdue_creator', payload: { ...ctx, pendingNames: unsigned.map((u) => u.display_name).join(', ') }, respectQuietHours: true },
          trx,
        );
      });
    }
    return docs.length;
  }

  private async certificates(now: Date) {
    let sent = 0;
    for (const [days, column] of [
      [30, 'notified_30d_at'],
      [7, 'notified_7d_at'],
    ] as const) {
      const certs = await this.db
        .selectFrom('company_certificates as cc')
        .innerJoin('companies as c', 'c.id', 'cc.company_id')
        .select(['cc.id', 'cc.company_id', 'cc.subject', 'cc.not_after', 'c.name as companyName'])
        .where('cc.is_active', '=', true)
        .where(column, 'is', null)
        .where('cc.not_after', '>', now)
        .where('cc.not_after', '<=', new Date(now.getTime() + days * DAY))
        // inside 7 days only the 7-day notice goes out
        .where('cc.not_after', '>', days === 30 ? new Date(now.getTime() + 7 * DAY) : now)
        .execute();
      for (const cert of certs) {
        await this.db.transaction().execute(async (trx) => {
          await trx.updateTable('company_certificates').set(days === 7 ? { notified_7d_at: now, notified_30d_at: now } : { notified_30d_at: now }).where('id', '=', cert.id).execute();
          const daysLeft = Math.max(0, Math.ceil((cert.not_after.getTime() - now.getTime()) / DAY));
          for (const userId of await this.finalize.adminIds(cert.company_id)) {
            await this.notifications.enqueue(
              { userId, companyId: cert.company_id, type: 'cert.expiring', payload: { companyName: cert.companyName, subject: cert.subject, notAfter: cert.not_after, daysLeft }, respectQuietHours: true },
              trx,
            );
          }
        });
        sent++;
      }
    }
    return sent;
  }
}
