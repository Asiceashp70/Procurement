import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config/config';

export interface LineIdentity {
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  isFriend: boolean | null;
}

const AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const FRIENDSHIP_URL = 'https://api.line.me/friendship/v1/status';

/** AUTH-01/02: LINE Login v2.1 (OAuth 2 + OpenID Connect) with state, nonce, PKCE and bot_prompt=aggressive. */
@Injectable()
export class LineLoginService {
  private readonly log = new Logger(LineLoginService.name);

  get enabled() {
    return Boolean(config().LINE_LOGIN_CHANNEL_ID && config().LINE_LOGIN_CHANNEL_SECRET);
  }

  get callbackUrl() {
    return `${config().API_BASE_URL.replace(/\/$/, '')}/auth/line/callback`;
  }

  newAuthRequest() {
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config().LINE_LOGIN_CHANNEL_ID,
      redirect_uri: this.callbackUrl,
      state,
      scope: 'profile openid',
      nonce,
      bot_prompt: 'aggressive',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), state, nonce, codeVerifier };
  }

  async exchange(code: string, nonce: string, codeVerifier: string): Promise<LineIdentity> {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.callbackUrl,
        client_id: config().LINE_LOGIN_CHANNEL_ID,
        client_secret: config().LINE_LOGIN_CHANNEL_SECRET,
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenRes.ok) throw new Error(`LINE token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    const token = (await tokenRes.json()) as { access_token: string; id_token: string };

    // LINE verifies signature, audience, expiry and nonce for us.
    const verifyRes = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: token.id_token, client_id: config().LINE_LOGIN_CHANNEL_ID, nonce }),
    });
    if (!verifyRes.ok) throw new Error(`LINE id_token verification failed: ${verifyRes.status} ${await verifyRes.text()}`);
    const claims = (await verifyRes.json()) as { sub: string; name?: string; picture?: string; nonce?: string };
    if (claims.nonce !== nonce) throw new Error('LINE id_token nonce mismatch');

    let isFriend: boolean | null = null;
    try {
      const f = await fetch(FRIENDSHIP_URL, { headers: { authorization: `Bearer ${token.access_token}` } });
      if (f.ok) isFriend = ((await f.json()) as { friendFlag: boolean }).friendFlag;
    } catch (err) {
      this.log.warn(`friendship status unavailable: ${String(err)}`);
    }
    return { lineUserId: claims.sub, displayName: claims.name ?? null, pictureUrl: claims.picture ?? null, isFriend };
  }
}
