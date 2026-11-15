import { Controller, Get, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { CurrentUser, Public, SuperAdminOnly } from '../auth/decorators';
import { config } from '../config/config';
import { InjectDb, type Db } from '../db/database';
import type { User } from '../db/types';
import { SchedulerService } from '../documents/scheduler.service';
import { buildCards } from '../notifications/templates';

/**
 * Testing without LINE. Every route answers 404 unless DEV_LOGIN_ENABLED=true
 * and NODE_ENV is not production (config validation refuses that combination too).
 */
@Controller('dev')
export class DevController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly scheduler: SchedulerService,
  ) {}

  private ensureEnabled() {
    if (!config().DEV_LOGIN_ENABLED || config().NODE_ENV === 'production') throw new NotFoundException();
  }

  /** Accounts to log in as on the login page and in the user switcher. */
  @Public()
  @Get('accounts')
  async accounts() {
    this.ensureEnabled();
    return this.db
      .selectFrom('users as u')
      .select([
        'u.line_user_id as lineUserId',
        sql<string>`coalesce(u.first_name || ' ' || u.last_name, u.line_display_name, 'ยังไม่ลงทะเบียน')`.as('name'),
        'u.is_super_admin as isSuperAdmin',
        sql<boolean>`u.registered_at IS NOT NULL`.as('registered'),
        sql<string | null>`(SELECT string_agg(
            CASE WHEN m.role = 'admin' THEN 'ผู้ดูแลบริษัท'
                 WHEN m.status = 'pending' THEN 'รออนุมัติ'
                 WHEN m.can_create_documents THEN 'สร้างเอกสารได้'
                 ELSE 'พนักงาน' END, ', ')
          FROM memberships m WHERE m.user_id = u.id AND m.status IN ('approved', 'pending'))`.as('roles'),
        sql<string | null>`(SELECT p.name FROM memberships m JOIN positions p ON p.id = m.position_id WHERE m.user_id = u.id LIMIT 1)`.as('position'),
      ])
      .orderBy('u.line_user_id')
      .limit(50)
      .execute();
  }

  /** What would have been sent to me on LINE, newest first. */
  @Get('line-inbox')
  async inbox(@CurrentUser() user: User) {
    this.ensureEnabled();
    const rows = await this.db
      .selectFrom('notifications')
      .select(['id', 'type', 'payload', 'status', 'created_at as createdAt', 'scheduled_at as scheduledAt', 'sent_at as sentAt'])
      .where('user_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    const app = config().APP_ORIGIN.replace(/\/$/, '');
    return rows.map((r) => {
      let cards: ReturnType<typeof buildCards> = [];
      try {
        cards = buildCards(r.type, r.payload);
      } catch {
        cards = [{ altText: r.type, title: r.type, rows: [] }];
      }
      // links are relative so they also work from a phone on the local network
      return {
        ...r,
        cards: cards.map((c) => ({ ...c, button: c.button ? { label: c.button.label, path: c.button.url.startsWith(app) ? c.button.url.slice(app.length) || '/' : c.button.url } : undefined })),
      };
    });
  }

  /** Runs the timed reminders (due soon, overdue, certificate expiry) now instead of waiting 5 minutes. */
  @SuperAdminOnly()
  @Post('run-reminders')
  @HttpCode(200)
  async runReminders() {
    this.ensureEnabled();
    return this.scheduler.runOnce();
  }
}
