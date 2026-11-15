import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config';

export const SESSION_COOKIE = 'zenhere_session';
export const OAUTH_COOKIE = 'zenhere_oauth';
const SESSION_TTL_S = 7 * 24 * 60 * 60; // AUTH-03: 7 days, renewed while in use
const RENEW_AFTER_S = 24 * 60 * 60;

interface SessionClaims {
  sub: string; // users.id
  typ: 'session';
  iat: number;
}

function cookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config().APP_ORIGIN.startsWith('https://'),
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function issueSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId, typ: 'session' }, config().JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: SESSION_TTL_S,
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_S * 1000));
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

export function readSession(token: string | undefined): { userId: string; shouldRenew: boolean } | null {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, config().JWT_SECRET, { algorithms: ['HS256'] }) as SessionClaims;
    if (claims.typ !== 'session') return null;
    return { userId: claims.sub, shouldRenew: Date.now() / 1000 - claims.iat > RENEW_AFTER_S };
  } catch {
    return null;
  }
}

/** Short-lived signed cookie that carries state + nonce across the LINE redirect. */
export interface OAuthPending {
  state: string;
  nonce: string;
  next: string;
}

export function setOAuthCookie(res: Response, data: OAuthPending) {
  const token = jwt.sign({ ...data, typ: 'oauth' }, config().JWT_SECRET, { algorithm: 'HS256', expiresIn: 600 });
  res.cookie(OAUTH_COOKIE, token, { ...cookieOptions(600_000), path: '/' });
}

export function takeOAuthCookie(token: string | undefined, res: Response): OAuthPending | null {
  res.clearCookie(OAUTH_COOKIE, { path: '/' });
  if (!token) return null;
  try {
    const c = jwt.verify(token, config().JWT_SECRET, { algorithms: ['HS256'] }) as OAuthPending & { typ: string };
    return c.typ === 'oauth' ? { state: c.state, nonce: c.nonce, next: c.next } : null;
  } catch {
    return null;
  }
}

/** Only same-site relative paths are allowed after login (no open redirect). */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  return next.slice(0, 500);
}
