import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, errorText } from '../lib/api';
import { useActiveMembership } from '../session';

const MAX = 50 * 1024 * 1024;

/** DOC-01, DOC-02 */
export function NewDocumentPage() {
  const m = useActiveMembership();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [docType, setDocType] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!m) return <Navigate to="/" replace />;
  if (!m.canCreateDocuments) return <div className="alert alert-error">คุณยังไม่มีสิทธิ์สร้างเอกสาร ติดต่อผู้ดูแลบริษัท</div>;

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.size > MAX) return setError('ไฟล์ใหญ่เกิน 50 MB');
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) return setError('รองรับไฟล์ PDF, JPG, PNG');
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('companyId', m.companyId);
      fd.append('title', title);
      fd.append('description', description);
      fd.append('docType', docType);
      fd.append('tags', tags);
      fd.append('file', file);
      const r = await api.post<{ id: string }>('/documents', fd);
      navigate(`/documents/${r.id}/edit`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h1>สร้างเอกสาร</h1>
      <p className="muted small">บริษัท: {m.companyName}</p>
      {error && <div className="alert alert-error">{error}</div>}
      <label className="field">
        <span>
          ไฟล์ (PDF, JPG, PNG ไม่เกิน 50 MB หรือ 200 หน้า) <span className="req">*</span>
        </span>
        <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      <label className="field">
        <span>
          ชื่อเรื่อง <span className="req">*</span>
        </span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      <label className="field">
        <span>รายละเอียด</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>ประเภทเอกสาร</span>
          <input type="text" value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="เช่น สัญญาจ้าง, ใบลา" />
        </label>
        <label className="field">
          <span>แท็ก (คั่นด้วย ,)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="HR, 2569" />
        </label>
      </div>
      <button className="btn-primary btn-block" disabled={!file || busy || !title.trim()}>
        {busy ? 'กำลังอัปโหลด...' : 'ถัดไป: วางกรอบเซ็น'}
      </button>
    </form>
  );
}
