import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { takeNext } from '../App';
import { ProfileForm, type ProfileValues } from '../components/ProfileForm';
import { SignatureEditor, type SignatureResult } from '../components/SignatureEditor';
import { api, errorText, fieldErrors, type Me } from '../lib/api';
import { useSession } from '../session';

/** REG-01, REG-03, REG-08: profile -> signature -> PDPA consent, then submit. */
export function RegisterPage() {
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<ProfileValues>({ firstName: '', lastName: '', nickname: '', phone: '', email: '' });
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [savingSig, setSavingSig] = useState(false);
  const [consent, setConsent] = useState<{ version: string; text: string } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<{ version: string; text: string }>('/consent').then(setConsent);
    if (me?.activeSignature) setSigUrl(`/api/me/signatures/${me.activeSignature.id}/image`);
  }, [me?.activeSignature]);

  if (me?.registered) return <Navigate to="/" replace />;

  const saveSignature = async (r: SignatureResult) => {
    setSavingSig(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('method', r.method);
      fd.append('file', r.blob, 'signature.png');
      const sig = await api.post<{ id: string }>('/me/signatures', fd);
      setSigUrl(`/api/me/signatures/${sig.id}/image`);
      await refresh();
      setStep(2);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingSig(false);
    }
  };

  const submit = async () => {
    if (!consent) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<Me>('/me/register', { ...profile, nickname: profile.nickname || null, consentVersion: consent.version, consentAccepted: true });
      await refresh();
      navigate(takeNext(), { replace: true });
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) {
        setServerErrors(fe);
        setStep(0);
      }
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <h1>ลงทะเบียนครั้งแรก</h1>
      <div className="steps">
        {[0, 1, 2].map((i) => (
          <div key={i} className={i <= step ? 'done' : ''} />
        ))}
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {step === 0 && (
        <div className="card">
          <h2>1. ข้อมูลส่วนตัว</h2>
          <ProfileForm
            initial={profile}
            serverErrors={serverErrors}
            submitLabel="ถัดไป: ตั้งลายเซ็น"
            onSubmit={(v) => {
              setProfile(v);
              setServerErrors({});
              setStep(1);
            }}
          />
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <h2>2. ตั้งลายเซ็น</h2>
          <p className="muted small">ลายเซ็นนี้จะถูกใช้เมื่อคุณเซ็นเอกสาร เปลี่ยนภายหลังได้ที่หน้าข้อมูลของฉัน</p>
          {sigUrl && (
            <div className="alert alert-ok row between">
              <span>มีลายเซ็นแล้ว</span>
              <button className="btn-sm" onClick={() => setStep(2)}>
                ใช้อันนี้ ไปต่อ
              </button>
            </div>
          )}
          <SignatureEditor onSave={saveSignature} saving={savingSig} />
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setStep(0)}>
            ← ย้อนกลับ
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card stack">
          <h2>3. ตรวจสอบและยินยอม</h2>
          <div className="small">
            <div>
              <strong>
                {profile.firstName} {profile.lastName}
              </strong>
              {profile.nickname && ` (${profile.nickname})`}
            </div>
            <div className="muted">
              {profile.phone} · {profile.email}
            </div>
          </div>
          {sigUrl && (
            <div className="checker">
              <img src={sigUrl} alt="ลายเซ็นของคุณ" />
            </div>
          )}
          {consent && <div className="consent-text">{consent.text}</div>}
          <label className="checkbox">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>ฉันอ่านและยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลตามที่ระบุข้างต้น</span>
          </label>
          <button className="btn-primary btn-block" disabled={!agreed || busy || !sigUrl} onClick={submit}>
            {busy ? 'กำลังส่ง...' : 'ส่งลงทะเบียน'}
          </button>
          <button className="btn-ghost" onClick={() => setStep(1)}>
            ← ย้อนกลับ
          </button>
        </div>
      )}
    </main>
  );
}
