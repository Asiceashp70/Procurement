import { Body, Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config/config';
import { zbody } from '../common/validation';
import { UsersService } from '../users/users.service';
import { AllowUnregistered, Public } from './decorators';
import { LineLoginService } from './line-login.service';
import { clearSession, issueSession, OAUTH_COOKIE, safeNextPath, setOAuthCookie, takeOAuthCookie } from './session';

const devLoginSchema = z.object({
  lineUserId: z.string().regex(/^U[0-9a-f]{32}$/, 'รหัสบัญชีต้องขึ้นต้นด้วย U ตามด้วยเลขฐานสิบหก 32 ตัว'),
  displayName: z.string().max(100).optional(),
});

@Controller('auth')
export class AuthController {
  private readonly log = new Logger(AuthController.name);

  constructor(
    private readonly line: LineLoginService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Get('config')
  authConfig() {
    const c = config();
    return {
      lineLoginEnabled: this.line.enabled,
      devLoginEnabled: c.DEV_LOGIN_ENABLED && c.NODE_ENV !== 'production',
      oaAddFriendUrl: c.LINE_OA_BASIC_ID ? `https://line.me/R/ti/p/${encodeURIComponent(c.LINE_OA_BASIC_ID)}` : null,
      consentVersion: c.PDPA_CONSENT_VERSION,
    };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('line/login')
  lineLogin(@Query('next') next: string | undefined, @Res() res: Response) {
    if (!this.line.enabled) return res.redirect(`${config().APP_ORIGIN}/login?error=line_not_configured`);
    const r = this.line.newAuthRequest();
    // code_verifier rides in the same signed cookie as the nonce
    setOAuthCookie(res, { state: r.state, nonce: `${r.nonce}.${r.codeVerifier}`, next: safeNextPath(next) });
    res.redirect(r.url);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('line/callback')
  async lineCallback(
    @Query() q: { code?: string; state?: string; error?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const app = config().APP_ORIGIN;
    const pending = takeOAuthCookie(req.cookies?.[OAUTH_COOKIE], res);
    if (q.error) return res.redirect(`${app}/login?error=${encodeURIComponent(q.error)}`);
    if (!pending || !q.code || !q.state || q.state !== pending.state) {
      return res.redirect(`${app}/login?error=state_mismatch`);
    }
    try {
      const [nonce, codeVerifier] = pending.nonce.split('.');
      const identity = await this.line.exchange(q.code, nonce, codeVerifier);
      const user = await this.users.upsertFromLine(identity);
      issueSession(res, user.id);
      res.redirect(`${app}${user.registered_at ? pending.next : '/register'}`);
    } catch (err) {
      this.log.error(`LINE login failed: ${String(err)}`);
      res.redirect(`${app}/login?error=line_login_failed`);
    }
  }

  /** Local development only (refused in production by config validation). */
  @Public()
  @Post('dev/login')
  @HttpCode(200)
  async devLogin(@Body(zbody(devLoginSchema)) body: z.infer<typeof devLoginSchema>, @Res({ passthrough: true }) res: Response) {
    const c = config();
    if (!c.DEV_LOGIN_ENABLED || c.NODE_ENV === 'production') throw new ForbiddenException('dev login is disabled');
    const user = await this.users.upsertFromLine({
      lineUserId: body.lineUserId,
      displayName: body.displayName ?? 'Dev user',
      pictureUrl: null,
      isFriend: true,
    });
    issueSession(res, user.id);
    return { ok: true, registered: Boolean(user.registered_at) };
  }

  @AllowUnregistered()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    clearSession(res);
    return { ok: true };
  }
}

