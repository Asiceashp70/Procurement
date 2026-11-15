import type { Liff } from '@line/liff';
import { api } from './api';

/**
 * LIFF: when the web app is opened from LINE (message buttons, invite QR), log in
 * with the user's LINE identity silently. The SDK is loaded only in that case.
 */
let liff: Liff | null = null;
let initPromise: Promise<boolean> | null = null;

/** Opened by LINE: the LINE in-app browser, or the first hop of a liff.line.me link. */
export function openedFromLine() {
  return /\bLine\//i.test(navigator.userAgent) || /[?&]liff\./.test(window.location.search);
}

export function initLiff(liffId: string): Promise<boolean> {
  initPromise ??= import('@line/liff')
    .then(async (m) => {
      liff = m.default;
      // with liff.state in the URL the SDK moves on to the requested page by itself
      await liff.init({ liffId });
      return true;
    })
    .catch((err) => {
      console.warn('LIFF init failed', err);
      return false;
    });
  return initPromise;
}

export const inLineApp = () => {
  try {
    return Boolean(liff?.isInClient());
  } catch {
    return false;
  }
};

/** Exchanges the LIFF ID token for our session. Returns true when logged in. */
export async function liffLogin(): Promise<boolean> {
  if (!liff || !liff.isLoggedIn()) return false;
  const idToken = liff.getIDToken();
  if (!idToken) return false;
  try {
    await api.post('/auth/liff', { idToken, accessToken: liff.getAccessToken() ?? undefined });
    return true;
  } catch (err) {
    console.warn('LIFF login refused', err);
    return false;
  }
}

/** Back to the LINE chat (only inside the LINE app). */
export function closeLiffWindow() {
  if (inLineApp()) liff?.closeWindow();
}
