import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../lib/api';
import { thaiDateTime } from '../lib/thai';

interface VerifyResult {
  sha256: string;
  match: 'final' | 'original' | 'none';
  companyName?: string;
  completedAt?: string | null;
  sealStatus?: string;
  document?: { id: string; title: string } | null;
}

/** SGN-08: compare a file someone holds with the system's records by SHA-256. */
export function VerifyPage() {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setResult(await api.post<VerifyResult>('/verify', fd));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack">
      <h1>ตรวจสอบไฟล์</h1>
      <p className="muted small">เลือกไฟล์ PDF ที่ได้รับมา ระบบจะเทียบลายนิ้วมือดิจิทัล (SHA-256) กับเอกสารในระบบ ถ้าไฟล์ถูกแก้แม้ 1 ไบต์ จะไม่ตรงกัน</p>
      <label className="btn btn-primary">
        {busy ? 'กำลังตรวจ...' : 'เลือกไฟล์'}
        <input type="file" hidden onChange={(e) => check(e.target.files?.[0])} />
      </label>
      {error && <div className="alert alert-error">{error}</div>}
      {result?.match === 'final' && (
        <div className="alert alert-ok">
          <strong>✓ ตรงกับไฟล์ฉบับสมบูรณ์ในระบบ</strong>
          <div className="small">
            {result.companyName} · เซ็นครบ {thaiDateTime(result.completedAt)}
            {result.sealStatus === 'sealed' && ' · ซีลด้วยใบรับรองดิจิทัล'}
          </div>
          {result.document && <Link to={`/documents/${result.document.id}`}>{result.document.title}</Link>}
        </div>
      )}
      {result?.match === 'original' && (
        <div className="alert alert-info">
          <strong>ตรงกับต้นฉบับก่อนเซ็น</strong>
          <div className="small">ไฟล์นี้คือต้นฉบับที่อัปโหลด ยังไม่ใช่ฉบับที่ลงนามครบ ({result.companyName})</div>
          {result.document && <Link to={`/documents/${result.document.id}`}>{result.document.title}</Link>}
        </div>
      )}
      {result?.match === 'none' && (
        <div className="alert alert-error">
          <strong>✕ ไม่ตรงกับต้นฉบับ</strong>
          <div className="small">ไม่พบไฟล์นี้ในระบบ ไฟล์อาจถูกแก้ไข หรือไม่ได้มาจากระบบนี้</div>
        </div>
      )}
      {result && <div className="hash muted">SHA-256: {result.sha256}</div>}
    </div>
  );
}
