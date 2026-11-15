import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config/config';
import { PermanentJobError } from '../jobs/jobs.service';

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';

@Injectable()
export class LinePushService {
  private readonly log = new Logger(LinePushService.name);

  /**
   * Sends a push message. X-Line-Retry-Key makes retries idempotent: LINE answers
   * 409 when the same key was already accepted, which we treat as success.
   */
  async push(to: string, messages: unknown[], retryKey: string): Promise<{ requestId: string | null }> {
    if (!config().LINE_PUSH_ENABLED || !config().LINE_MESSAGING_ACCESS_TOKEN) {
      this.log.log(`[LINE push disabled] to=${to} ${JSON.stringify(messages).slice(0, 300)}`);
      return { requestId: 'push-disabled' };
    }
    const res = await fetch(PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config().LINE_MESSAGING_ACCESS_TOKEN}`,
        'x-line-retry-key': retryKey,
      },
      body: JSON.stringify({ to, messages }),
    });
    const requestId = res.headers.get('x-line-request-id');
    if (res.ok || res.status === 409) return { requestId };
    const text = (await res.text()).slice(0, 500);
    // 429 (rate/quota) and 5xx may succeed later; other 4xx will not.
    if (res.status === 429 || res.status >= 500) throw new Error(`LINE push ${res.status}: ${text}`);
    throw new PermanentJobError(`LINE push ${res.status}: ${text}`);
  }

  /** Monthly quota and usage of the OA (push messages count against it). */
  async quota(): Promise<{ limit: number | null; used: number } | null> {
    if (!config().LINE_MESSAGING_ACCESS_TOKEN) return null;
    const headers = { authorization: `Bearer ${config().LINE_MESSAGING_ACCESS_TOKEN}` };
    try {
      const [q, c] = await Promise.all([
        fetch('https://api.line.me/v2/bot/message/quota', { headers }).then((r) => r.json() as Promise<{ type: string; value?: number }>),
        fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers }).then((r) => r.json() as Promise<{ totalUsage: number }>),
      ]);
      return { limit: q.type === 'limited' ? (q.value ?? null) : null, used: c.totalUsage };
    } catch (err) {
      this.log.warn(`quota lookup failed: ${String(err)}`);
      return null;
    }
  }
}
