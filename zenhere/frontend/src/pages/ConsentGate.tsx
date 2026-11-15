import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { useSession } from '../session';

/** Shown when the PDPA notice changed since the user last agreed (REG-08). */
export function ConsentGate() {
  const { refresh } = useSession();
  const [consent, setConsent] = useState<{ version: string; text: string } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ version: string; text: string }>('/consent').then(setConsent);
  }, []);
  const accept = async () => {
    try {
      await api.post('/me/consent', { version: consent!.version });
      await refresh();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <div className="card stack">
        <h2>ข้อความยินยอมมีการปรับปรุง</h2>
        <p className="muted small">กรุณาอ่านและยินยอมอีกครั้งก่อนใช้งานต่อ</p>
        {consent && <div className="consent-text">{consent.text}</div>}
        {error && <div className="alert alert-error">{error}</div>}
        <label className="checkbox">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>ฉันอ่านและยินยอมตามที่ระบุข้างต้น</span>
        </label>
        <button className="btn-primary" disabled={!agreed || !consent} onClick={accept}>
          ยินยอม
        </button>
      </div>
    </main>
  );
}
