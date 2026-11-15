import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { hostname } from 'node:os';
import { config } from '../config/config';
import { InjectDb, type Db } from '../db/database';
import type { Database } from '../db/types';

/** Thrown by a handler when retrying cannot help (bad input, LINE says 400). */
export class PermanentJobError extends Error {}

type Handler = (payload: Record<string, unknown>, attempt: number) => Promise<void>;

const POLL_MS = 2000;
const BATCH = 10;
const STUCK_AFTER = '5 minutes';

/**
 * Background jobs stored in PostgreSQL (no Redis on Windows). Workers claim rows
 * with FOR UPDATE SKIP LOCKED so several processes can poll safely.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(JobsService.name);
  private readonly handlers = new Map<string, Handler>();
  private readonly workerId = `${hostname()}:${process.pid}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(@InjectDb() private readonly db: Db) {}

  register(type: string, handler: Handler) {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: Record<string, unknown>, runAt: Date = new Date(), trx?: Transaction<Database>) {
    await (trx ?? this.db)
      .insertInto('jobs')
      .values({ type, payload: JSON.stringify(payload), run_at: runAt })
      .execute();
  }

  onModuleInit() {
    if (config().JOB_WORKER_ENABLED && config().NODE_ENV !== 'test') this.schedule();
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.log.error(`job poll failed: ${String(err)}`);
      }
      this.schedule();
    }, POLL_MS);
  }

  /** Claims and runs one batch of due jobs. Returns how many were processed. Public for tests. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.db
        .updateTable('jobs')
        .set({ status: 'queued', locked_at: null, locked_by: null })
        .where('status', '=', 'running')
        .where('locked_at', '<', sql<Date>`now() - ${STUCK_AFTER}::interval`)
        .execute();

      const claimed = await sql<{ id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }>`
        UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${this.workerId}, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
          ORDER BY run_at, id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
        )
        RETURNING id, type, payload, attempts, max_attempts`.execute(this.db);

      for (const job of claimed.rows) await this.execute(job);
      return claimed.rows.length;
    } finally {
      this.running = false;
    }
  }

  private async execute(job: { id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }) {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new PermanentJobError(`no handler for job type ${job.type}`);
      await handler(job.payload, job.attempts);
      await this.db.updateTable('jobs').set({ status: 'done', finished_at: new Date(), last_error: null }).where('id', '=', job.id).execute();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = err instanceof PermanentJobError || job.attempts >= job.max_attempts;
      this.log.warn(`job ${job.id} (${job.type}) attempt ${job.attempts} failed${final ? ' permanently' : ''}: ${message}`);
      const backoffSeconds = 30 * 2 ** (job.attempts - 1);
      await this.db
        .updateTable('jobs')
        .set(
          final
            ? { status: 'failed', finished_at: new Date(), last_error: message.slice(0, 2000) }
            : { status: 'queued', run_at: new Date(Date.now() + backoffSeconds * 1000), locked_at: null, locked_by: null, last_error: message.slice(0, 2000) },
        )
        .where('id', '=', job.id)
        .execute();
      if (final) {
        const onFail = this.handlers.get(`${job.type}:failed`);
        await onFail?.({ ...job.payload, error: message }, job.attempts).catch(() => undefined);
      }
    }
  }
}
