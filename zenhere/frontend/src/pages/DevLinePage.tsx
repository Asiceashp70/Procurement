import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { markLineSeen } from '../components/DevBar';
import { api, errorText } from '../lib/api';
import { thaiDateTime } from '../lib/thai';
import { useSession } from '../session';

interface Card {
  altText: string;
  title: string;
  color?: string;
  rows: [string, string][];
  note?: string;
  button?: { label: string; path: string };
}
interface Message {
  id: string;
  type: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  createdAt: string;
  scheduledAt: string;
  sentAt: string | null;
  cards: Card[];
}

/**
 * Development only: the LINE messages the system would have pushed to the
 * current user, drawn like LINE Flex cards. The buttons open the same pages
 * the real LINE buttons will open.
 */
export function DevLinePage() {
  const { me } = useSession();
  const [items, setItems] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => api.get<Message[]>('/dev/line-inbox').then(setItems, (e) => setError(errorText(e))), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (me && items) markLineSeen(me.id);
  }, [me, items]);

  const runReminders = async () => {
    try {
      const r = await api.post<{ dueSoon: number; overdue: number; certificates: number }>('/dev/run-reminders');
      setMsg(`รันการเตือนตามเวลาแล้ว: ใกล้ครบกำหนด ${r.dueSoon} ฉบับ · เลยกำหนด ${r.overdue} ฉบับ · ใบรับรอง ${r.certificates} ใบ`);
      load();
    } catch (err) {
      setMsg(errorText(err));
    }
  };

  return (
    <div>
      <div className="line-header">
        <span>📱</span>
        <div>
          <strong>ZenHere (ทดสอบ)</strong>
          <div className="small" style={{ opacity: 0.85 }}>ข้อความที่ระบบจะส่งถึง {me?.firstName} ทาง LINE เมื่อเชื่อม LINE แล้ว</div>
        </div>
      </div>
      <div className="alert alert-info small">
        ตอนนี้ยังไม่ได้เชื่อม LINE ระบบเก็บข้อความไว้ที่นี่แทน ข้อความเตือนอัตโนมัติช่วง 21:00–08:00 จะรอส่งตอน 08:00 (แสดงเป็น "รอส่ง")
      </div>
      {me?.isSuperAdmin && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn-sm" onClick={runReminders}>
            ⏱ รันการเตือนตามเวลาตอนนี้
          </button>
          <span className="muted small">ปกติระบบตรวจทุก 5 นาที (ใกล้ครบกำหนด / เลยกำหนด / ใบรับรองใกล้หมดอายุ)</span>
        </div>
      )}
      {msg && <div className="alert alert-ok small">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {items?.length === 0 && <p className="muted center">ยังไม่มีข้อความ</p>}
      <div className="line-chat">
        {items?.map((m) =>
          m.cards.map((c, i) => (
            <div key={`${m.id}-${i}`} className="line-msg">
              <div className="line-bubble">
                <div className="line-title" style={{ color: c.color ?? '#111' }}>
                  {c.title}
                </div>
                {c.rows.map(([k, v]) => (
                  <div key={k} className="line-row">
                    <span>{k}</span>
                    <span>{v || '-'}</span>
                  </div>
                ))}
                {c.note && <div className="line-note">{c.note}</div>}
                {c.button &&
                  (c.button.path.startsWith('/') ? (
                    <Link className="line-button" to={c.button.path}>
                      {c.button.label}
                    </Link>
                  ) : (
                    <a className="line-button" href={c.button.path}>
                      {c.button.label}
                    </a>
                  ))}
              </div>
              <div className="line-time">
                {thaiDateTime(m.status === 'pending' ? m.scheduledAt : m.sentAt ?? m.createdAt)}
                {m.status === 'pending' && ' · รอส่ง'}
                {m.status === 'failed' && ' · ส่งไม่สำเร็จ'}
              </div>
            </div>
          )),
        )}
      </div>
    </div>
  );
}
