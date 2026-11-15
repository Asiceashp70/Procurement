import { useEffect, useState } from 'react';
import { ProfileForm } from '../components/ProfileForm';
import { SignatureEditor, type SignatureResult } from '../components/SignatureEditor';
import { api, errorText, fieldErrors } from '../lib/api';
import { thaiDateTime } from '../lib/thai';
import { useSession } from '../session';

interface SignatureRow {
  id: string;
  method: 'draw' | 'upload';
  isActive: boolean;
  createdAt: string;
  deactivatedAt: string | null;
}

/** REG-07, SIG-06: edit own details and signature; old signatures stay in history. */
export function ProfilePage() {
  const { me, refresh } = useSession();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [editingSig, setEditingSig] = useState(false);
  const [savingSig, setSavingSig] = useState(false);
  const [history, setHistory] = useState<SignatureRow[]>([]);

  const loadHistory = () => api.get<SignatureRow[]>('/me/signatures').then(setHistory);
  useEffect(() => {
    loadHistory();
  }, []);
  if (!me) return null;

  const saveProfile = async (v: { firstName: string; lastName: string; nickname: string; phone: string; email: string }) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.put('/me/profile', { ...v, nickname: v.nickname || null });
      await refresh();
      setServerErrors({});
      setMsg({ ok: true, text: 'บันทึกข้อมูลแล้ว' });
    } catch (err) {
      setServerErrors(fieldErrors(err));
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const saveSignature = async (r: SignatureResult) => {
    setSavingSig(true);
    try {
      const fd = new FormData();
      fd.append('method', r.method);
      fd.append('file', r.blob, 'signature.png');
      await api.post('/me/signatures', fd);
      await Promise.all([refresh(), loadHistory()]);
      setEditingSig(false);
      setMsg({ ok: true, text: 'ตั้งลายเซ็นใหม่แล้ว เอกสารที่เซ็นไปแล้วยังใช้ลายเซ็นเดิม' });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setSavingSig(false);
    }
  };

  return (
    <div className="stack">
      <h1>ข้อมูลของฉัน</h1>
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div>}

      <div className="card">
        <h2>ลายเซ็น</h2>
        {me.activeSignature && !editingSig && (
          <div className="checker" style={{ marginBottom: 12 }}>
            <img src={`/api/me/signatures/${me.activeSignature.id}/image`} alt="ลายเซ็นปัจจุบัน" />
          </div>
        )}
        {editingSig ? (
          <>
            <SignatureEditor onSave={saveSignature} saving={savingSig} />
            <button className="btn-ghost" onClick={() => setEditingSig(false)}>
              ยกเลิก
            </button>
          </>
        ) : (
          <button onClick={() => setEditingSig(true)}>ตั้งลายเซ็นใหม่</button>
        )}
        {history.length > 1 && (
          <details style={{ marginTop: 12 }}>
            <summary>ประวัติลายเซ็น ({history.length})</summary>
            {history.map((s) => (
              <div key={s.id} className="list-item row between">
                <img className="sig-thumb" src={`/api/me/signatures/${s.id}/image`} alt="" loading="lazy" />
                <div className="small" style={{ textAlign: 'right' }}>
                  <div>{s.isActive ? <span className="badge badge-approved">ใช้งานอยู่</span> : <span className="muted">เลิกใช้แล้ว</span>}</div>
                  <div className="muted">
                    {s.method === 'draw' ? 'วาด' : 'รูปถ่าย'} · {thaiDateTime(s.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </details>
        )}
      </div>

      <div className="card">
        <h2>ข้อมูลส่วนตัว</h2>
        <ProfileForm
          initial={{ firstName: me.firstName ?? '', lastName: me.lastName ?? '', nickname: me.nickname ?? '', phone: me.phone ?? '', email: me.email ?? '' }}
          serverErrors={serverErrors}
          onSubmit={saveProfile}
          busy={busy}
          submitLabel="บันทึก"
        />
      </div>

      <div className="card small muted">
        บัญชีที่ใช้เข้าสู่ระบบ: {me.lineDisplayName} · {me.isOaFriend ? 'เปิดรับการแจ้งเตือนแล้ว' : 'ยังไม่ได้เปิดรับการแจ้งเตือน'}
      </div>
    </div>
  );
}
