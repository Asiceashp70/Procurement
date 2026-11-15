import { api } from './api';

export interface DevAccount {
  lineUserId: string;
  name: string;
  isSuperAdmin: boolean;
  registered: boolean;
  roles: string | null;
  position: string | null;
}

export const devAccounts = () => api.get<DevAccount[]>('/dev/accounts');

/** Logs in as a test account (development only) and reloads the app. */
export async function switchTo(lineUserId: string, displayName = 'ผู้ทดสอบ', to = '/') {
  await api.post('/auth/dev/login', { lineUserId, displayName });
  window.location.assign(to);
}

/** A LINE userId nobody has used yet, to try the first-time registration. */
export function newLineUserId() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return 'U' + hex;
}
