import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../lib/api';
import { DOC_BADGE, DOC_STATUS, type DocListItem } from '../lib/documents';
import { thaiDate } from '../lib/thai';
import { useActiveMembership } from '../session';

const BOXES = [
  ['todo', 'ต้องเซ็น'],
  ['waiting', 'รอคนอื่น'],
  ['done', 'เสร็จแล้ว'],
  ['drafts', 'ร่าง'],
] as const;

export function DocumentsPage() {
  const m = useActiveMembership();
  const [params, setParams] = useSearchParams();
  const box = params.get('box') ?? 'todo';
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: DocListItem[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!m) return;
    setData(null);
    const t = setTimeout(() => {
      api.get<{ items: DocListItem[]; hasMore: boolean }>(`/documents?companyId=${m.companyId}&box=${box}&q=${encodeURIComponent(q)}`).then(setData, (e) => setError(errorText(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [m, box, q]);

  if (!m) return <div className="alert alert-info">ยังไม่ได้เป็นสมาชิกบริษัทที่อนุมัติแล้ว</div>;
  return (
    <div>
      <div className="row between">
        <h1 style={{ margin: 0 }}>เอกสาร</h1>
        {m.canCreateDocuments && (
          <Link className="btn btn-primary" to="/documents/new">
            + สร้างเอกสาร
          </Link>
        )}
      </div>
      <nav className="tabs" style={{ marginTop: 12 }}>
        {BOXES.map(([k, label]) => (
          <button key={k} className={box === k ? 'active' : ''} onClick={() => setParams({ box: k })}>
            {label}
          </button>
        ))}
      </nav>
      <input type="search" placeholder="ค้นหาชื่อเอกสาร" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {error && <div className="alert alert-error">{error}</div>}
      {!data && <div className="loading">กำลังโหลด...</div>}
      {data?.items.length === 0 && <p className="muted center">ไม่มีเอกสาร</p>}
      {data?.items.map((d) => (
        <DocCard key={d.id} d={d} box={box} />
      ))}
    </div>
  );
}

export function DocCard({ d, box }: { d: DocListItem; box?: string }) {
  const navigate = useNavigate();
  const target = d.status === 'draft' ? `/documents/${d.id}/edit` : box === 'todo' ? `/documents/${d.id}/sign` : `/documents/${d.id}`;
  return (
    <button className="card" style={{ display: 'block', width: '100%', textAlign: 'left', fontWeight: 400, whiteSpace: 'normal' }} onClick={() => navigate(target)}>
      <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <strong style={{ flex: 1 }}>{d.title}</strong>
        <span className={`badge ${DOC_BADGE[d.status]}`}>{DOC_STATUS[d.status]}</span>
      </div>
      <div className="muted small" style={{ marginTop: 4 }}>
        จาก {d.creatorName} · {d.pageCount} หน้า
        {d.status !== 'draft' && ` · เซ็นแล้ว ${d.signedCount}/${d.signerCount}`}
        {d.dueAt && ` · กำหนด ${thaiDate(d.dueAt)}`}
      </div>
      {d.overdue && <span className="badge badge-rejected" style={{ marginTop: 6 }}>เลยกำหนด</span>}
      {box === 'todo' && <div className="small" style={{ marginTop: 6, color: 'var(--green-dark)', fontWeight: 600 }}>แตะเพื่อเซ็น →</div>}
    </button>
  );
}
