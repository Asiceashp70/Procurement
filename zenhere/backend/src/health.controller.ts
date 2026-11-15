import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'kysely';
import { Public } from './auth/decorators';
import { InjectDb, type Db } from './db/database';

/** For the Windows service monitor / reverse proxy health check. */
@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Public()
  @Get()
  async health() {
    try {
      await sql`SELECT 1`.execute(this.db);
      const stuck = await sql<{ n: number }>`SELECT count(*)::int AS n FROM jobs WHERE status = 'failed' AND finished_at > now() - interval '1 day'`.execute(this.db);
      return { status: 'ok', failedJobsLast24h: stuck.rows[0].n };
    } catch {
      throw new ServiceUnavailableException({ status: 'database_unavailable' });
    }
  }
}
