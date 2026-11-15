import { Controller, Headers, HttpCode, Logger, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { config } from '../config/config';
import { UsersService } from '../users/users.service';

interface LineEvent {
  type: string;
  source?: { type: string; userId?: string };
}

/** Messaging API webhook: keeps "is friend of the OA" up to date (follow / unfollow = block). */
@Controller('line')
export class LineWebhookController {
  private readonly log = new Logger(LineWebhookController.name);

  constructor(private readonly users: UsersService) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-line-signature') signature: string | undefined) {
    const secret = config().LINE_MESSAGING_CHANNEL_SECRET;
    if (!secret || !req.rawBody || !signature) throw new UnauthorizedException();
    const expected = createHmac('sha256', secret).update(req.rawBody).digest();
    const given = Buffer.from(signature, 'base64');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException();

    const events = (req.body as { events?: LineEvent[] }).events ?? [];
    for (const e of events) {
      const userId = e.source?.type === 'user' ? e.source.userId : undefined;
      if (!userId) continue;
      if (e.type === 'follow') await this.users.setFriendStatus(userId, true);
      else if (e.type === 'unfollow') await this.users.setFriendStatus(userId, false);
    }
    return { ok: true };
  }
}
