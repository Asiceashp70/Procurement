import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../lib/api';
import { useSession } from '../session';

const ERRORS: Record<string, string> = {
  state_mismatch: 'การเข้าสู่ระบบหมดเวลาหรือไม่ถูกต้อง กรุณาลองใหม่',
  line_login_failed: 'เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่',
  access_denied: 'คุณยกเลิกการเข้าสู่ระบบ',
  line_not_configured: 'ระบบยังไม่ได้ตั้งค่า LINE Login',
};

export function LoginPage() {
  const { me, config, loading, refresh } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next') ?? '/';
  const error = params.get('error');
  const [devId, setDevId] = useState('U00000000000000000000000000000001');
  const [devName, setDevName] = useState('ผู้ทดสอบ');
  const [devError, setDevError] = useState<string | null>(null);

  if (loading) return <div className="loading">กำลังโหลด...</div>;
  if (me) return <Navigate to={me.registered ? next : '/register'} replace />;

  const devLogin = async () => {
    setDevError(null);
    try {
      await api.post('/auth/dev/login', { lineUserId: devId.trim(), displayName: devName });
      const m = await refresh();
      navigate(m?.registered ? next : '/register', { replace: true });
    } catch (err) {
      setDevError(errorText(err));
    }
  };

  return (
    <main className="page" style={{ maxWidth: 440, paddingTop: 48 }}>
      <div className="center" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 48 }}>✍️</div>
        <h1>LINE e-Sign</h1>
        <p className="muted">เซ็นเอกสารของบริษัทบนมือถือ ยืนยันตัวตนด้วยบัญชี LINE</p>
      </div>
      {error && <div className="alert alert-error">{ERRORS[error] ?? `เข้าสู่ระบบไม่สำเร็จ (${error})`}</div>}
      <div className="card">
        <a className="btn btn-line btn-block" href={`/api/auth/line/login?next=${encodeURIComponent(next)}`} aria-disabled={!config?.lineLoginEnabled}>
          เข้าสู่ระบบด้วย LINE
        </a>
        {config && !config.lineLoginEnabled && <p className="muted small" style={{ marginTop: 8 }}>ยังไม่ได้ตั้งค่า LINE Login channel ใน server</p>}
        <p className="muted small" style={{ marginTop: 12 }}>
          ระบบจะชวนเพิ่มเพื่อน LINE OA ของบริษัทเพื่อรับแจ้งเตือนเอกสาร
        </p>
      </div>
      {config?.devLoginEnabled && (
        <div className="card">
          <h3>เข้าสู่ระบบแบบทดสอบ (เฉพาะเครื่องพัฒนา)</h3>
          <label className="field">
            <span>LINE userId</span>
            <input type="text" value={devId} onChange={(e) => setDevId(e.target.value)} />
          </label>
          <label className="field">
            <span>ชื่อที่แสดง</span>
            <input type="text" value={devName} onChange={(e) => setDevName(e.target.value)} />
          </label>
          {devError && <div className="alert alert-error">{devError}</div>}
          <button className="btn-block" onClick={devLogin}>
            เข้าสู่ระบบทดสอบ
          </button>
        </div>
      )}
    </main>
  );
}
