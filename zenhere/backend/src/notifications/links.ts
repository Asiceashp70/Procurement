import { config } from '../config/config';

/**
 * Where a notification button points. With a LIFF app the page opens inside LINE
 * (already logged in); otherwise in the browser at APP_ORIGIN.
 */
export function appLink(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const liff = config().LIFF_ID;
  return liff ? `https://liff.line.me/${liff}${p === '/' ? '' : p}` : `${config().APP_ORIGIN.replace(/\/$/, '')}${p}`;
}

/** The in-app path of a link made by appLink (for the test inbox). */
export function pathOfLink(url: string): string {
  const liff = config().LIFF_ID;
  const app = config().APP_ORIGIN.replace(/\/$/, '');
  for (const prefix of [liff ? `https://liff.line.me/${liff}` : null, app]) {
    if (prefix && url.startsWith(prefix)) return url.slice(prefix.length) || '/';
  }
  return url;
}
