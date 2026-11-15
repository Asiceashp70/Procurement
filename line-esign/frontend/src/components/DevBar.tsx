import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { devAccounts, newLineUserId, switchTo, type DevAccount } from '../lib/dev';
import { useSession } from '../session';

const SEEN_KEY = 'esign.dev.lineSeen';

/** Development only: test LINE inbox link with an unread count, and a quick user switcher. */
export function DevBar() {
  const { me, config } = useSession();
  const [accounts, setAccounts] = useState<DevAccount[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!config?.devLoginEnabled) return;
    devAccounts().then(setAccounts, () => undefined);
  }, [config?.devLoginEnabled]);

  useEffect(() => {
    if (!config?.devLoginEnabled || !me?.registered) return;
    const check = () =>
      api.get<{ createdAt: string }[]>('/dev/line-inbox').then((items) => {
        let seen = 0;
        try {
          seen = Number(localStorage.getItem(`${SEEN_KEY}.${me.id}`) ?? 0);
        } catch {
          /* ignore */
        }
        setUnread(items.filter((i) => new Date(i.createdAt).getTime() > seen).length);
      }, () => undefined);
    check();
    const t = setInterval(check, 10_000);
    return () => clearInterval(t);
  }, [config?.devLoginEnabled, me?.registered, me?.id]);

  if (!config?.devLoginEnabled || !me) return null;
  return (
    <>
      <Link to="/dev/line" className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap' }} title="ข้อความที่ระบบจะส่งทาง LINE">
        📱<span className="hide-sm"> LINE ทดสอบ</span>{unread > 0 && <span className="badge badge-rejected" style={{ marginLeft: 4 }}>{unread}</span>}
      </Link>
      <select
        aria-label="สลับผู้ใช้ทดสอบ"
        className="dev-switch"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__new') switchTo(newLineUserId(), 'ผู้ใช้ใหม่', '/register');
          else if (v) switchTo(v, accounts.find((a) => a.lineUserId === v)?.name);
        }}
      >
        <option value="">สลับ ▾</option>
        {accounts.map((a) => (
          <option key={a.lineUserId} value={a.lineUserId}>
            {a.name}
            {a.roles ? ` (${a.roles})` : a.isSuperAdmin ? ' (Super Admin)' : ''}
          </option>
        ))}
        <option value="__new">+ ผู้ใช้ใหม่ (ลองลงทะเบียน)</option>
      </select>
    </>
  );
}

export const markLineSeen = (userId: string) => {
  try {
    localStorage.setItem(`${SEEN_KEY}.${userId}`, String(Date.now()));
  } catch {
    /* ignore */
  }
};
