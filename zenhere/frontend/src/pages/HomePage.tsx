import { Link } from 'react-router-dom';
import { api, type MyMembership } from '../lib/api';
import type { DocListItem } from '../lib/documents';
import { DocCard } from './DocumentsPage';
import { STATUS_LABEL, thaiDate } from '../lib/thai';
import { getActiveCompany, setActiveCompany, useSession } from '../session';
import { useEffect, useState } from 'react';

export function HomePage() {
  const { me, config } = useSession();
  const [active, setActive] = useState(getActiveCompany());
  if (!me) return null;
  const approved = me.memberships.filter((m) => m.status === 'approved' && m.companyStatus === 'active');
  const current = approved.find((m) => m.companyId === active) ?? approved[0];

  return (
    <div className="stack">
      {!me.isOaFriend && (
        <div className="alert alert-warn">
          <strong>ยังไม่ได้เปิดรับการแจ้งเตือน</strong>
          <div className="small">คุณจะไม่ได้รับแจ้งเตือนเมื่อมีเอกสารให้เซ็น</div>
          {config?.oaAddFriendUrl && (
            <a className="btn btn-sm btn-primary" style={{ marginTop: 8 }} href={config.oaAddFriendUrl}>
              เปิดรับการแจ้งเตือน
            </a>
          )}
        </div>
      )}

      {approved.length > 1 && (
        <label className="field">
          <span>บริษัทที่ใช้งาน</span>
          <select
            value={current?.companyId}
            onChange={(e) => {
              setActiveCompany(e.target.value);
              setActive(e.target.value);
            }}
          >
            {approved.map((m) => (
              <option key={m.companyId} value={m.companyId}>
                {m.companyName}
              </option>
            ))}
          </select>
        </label>
      )}

      {current && (
        <div className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{current.companyName}</h2>
            {current.role === 'admin' && <span className="badge badge-admin">ผู้ดูแล</span>}
          </div>
          <p className="muted small">
            {[current.employeeCode, current.departmentName, current.positionName].filter(Boolean).join(' · ')}
          </p>
          <TodoDocs companyId={current.companyId} />
          <div className="row" style={{ marginBottom: 8 }}>
            <Link className="btn" to="/documents">
              เอกสารทั้งหมด
            </Link>
            {current.canCreateDocuments && (
              <Link className="btn btn-primary" to="/documents/new">
                + สร้างเอกสาร
              </Link>
            )}
          </div>
          {current.role === 'admin' && (
            <Link className="btn btn-block" to={`/c/${current.companyId}/admin`}>
              หลังบ้านบริษัท
            </Link>
          )}
        </div>
      )}

      {me.isSuperAdmin && (
        <Link className="btn btn-block" to="/admin">
          หลังบ้าน Super Admin
        </Link>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>บริษัทของฉัน</h2>
          <Link className="btn btn-sm btn-primary" to="/join">
            + เข้าร่วมบริษัท
          </Link>
        </div>
        {me.memberships.length === 0 && <p className="muted">ยังไม่ได้เข้าร่วมบริษัท ขอลิงก์เชิญหรือรหัส 8 หลักจากฝ่ายบุคคล</p>}
        {me.memberships.map((m) => (
          <MembershipRow key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

function MembershipRow({ m }: { m: MyMembership }) {
  const status = m.companyStatus === 'suspended' ? 'suspended' : m.status;
  return (
    <div className="list-item">
      <div className="row between">
        <strong>{m.companyName}</strong>
        <span className={`badge badge-${status}`}>{m.companyStatus === 'suspended' ? 'บริษัทถูกระงับ' : STATUS_LABEL[m.status]}</span>
      </div>
      <div className="muted small">
        {[m.employeeCode, m.departmentName, m.positionName].filter(Boolean).join(' · ')} · ส่งคำขอ {thaiDate(m.requestedAt)}
      </div>
      {m.status === 'rejected' && (
        <div className="small" style={{ marginTop: 4 }}>
          เหตุผล: {m.rejectReason} · <Link to="/join">ส่งคำขอใหม่</Link>
        </div>
      )}
    </div>
  );
}

/** Documents waiting for my signature, right on the home page. */
function TodoDocs({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<DocListItem[] | null>(null);
  useEffect(() => {
    api.get<{ items: DocListItem[] }>(`/documents?companyId=${companyId}&box=todo`).then((r) => setItems(r.items), () => setItems([]));
  }, [companyId]);
  if (!items) return null;
  if (!items.length) return <p className="muted small">ไม่มีเอกสารรอคุณเซ็น</p>;
  return (
    <div style={{ marginBottom: 8 }}>
      <h3>รอคุณเซ็น ({items.length})</h3>
      {items.slice(0, 5).map((d) => (
        <DocCard key={d.id} d={d} box="todo" />
      ))}
    </div>
  );
}
