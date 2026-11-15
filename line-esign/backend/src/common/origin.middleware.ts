import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/config';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in addition to SameSite=Lax cookies: every state-changing request
 * must come from the web app's own origin. The LINE webhook is signed instead.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (SAFE.has(req.method) || req.originalUrl.split('?')[0].endsWith('/line/webhook')) return next();
    const allowed = new URL(config().APP_ORIGIN).origin;
    const origin = req.get('origin') ?? (req.get('referer') ? safeOrigin(req.get('referer')!) : null);
    // development: a phone on the same network opens http://<pc-ip>:5173; same-host requests are fine
    const sameHost = config().NODE_ENV !== 'production' && origin !== null && hostOf(origin) === req.get('host');
    if (origin !== allowed && !sameHost) throw new ForbiddenException('origin not allowed');
    next();
  }
}

function safeOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function hostOf(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
