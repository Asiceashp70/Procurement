import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuditTable, type AuditPage } from '../components/AuditTable';
import { api, errorText } from '../lib/api';
import { bangkokDayStart, STATUS_LABEL, thaiDate } from '../lib/thai';
import { useSession } from '../session';

interface CompanyRow {
  id: string;
  name: string;
  taxId: string | null;
  address: string | null;
  status: 'active' | 'suspended';
  createdAt: string;
  memberCount: number;
  pendingCount: number;
  admins: { userId: string; name: string }[];
}
interface Overview {
  companies: Record<string, number>;
  registeredUsers: number;
  lineMessages: { sentThisMonth: number; quota: { limit: number | null; used: number } | null };
}
interface UserHit {
  id: string;
  firstName: string | null;
  lastName: string | null;
  lineDisplayName: string | null;
  phone: string | null;
}

/** ADM-01, ADM-03, system log for the Super Admin. */
export function SuperAdminPage() {
  const { me } = useSession();
  const [tab, setTab] = useState<'companies' | 'log'>('companies');
  if (!me?.isSuperAdmin) return <div className="alert alert-error">เฉพาะ Super Admin</div>;
  return (
    <div>
      <div className="row between">
        <h1 style={{ margin: 0 }}>หลังบ้าน Super Admin</h1>
        <Link to="/" className="small">
          ← หน้าแรก
        </Link>
      </div>
      <nav className="tabs" style={{ marginTop: 12 }}>
        <button className={tab === 'companies' ? 'active' : ''} onClick={() => setTab('companies')}>
          บริษัท
        </button>
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
          Log ระบบ
        </button>
      </nav>
      {tab === 'companies' ? <Companies /> : <SystemLog />}
    </div>
  );
}

function Companies() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string; name: string; taxId: string; address: string } | null>(null);
  const [appointFor, setAppointFor] = useState<CompanyRow | null>(null);

  const load = useCallback(() => {
    api.get<Overview>('/admin/overview').then(setOverview);
    api.get<CompanyRow[]>(`/admin/companies?q=${encodeURIComponent(q)}`).then(setRows, (e) => setError(errorText(e)));
  }, [q]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const body = { name: form.name, taxId: form.taxId || null, address: form.address || null };
    run(async () => {
      await (form.id ? api.patch(`/admin/companies/${form.id}`, body) : api.post('/admin/companies', body));
      setForm(null);
    });
  };
  const toggle = (c: CompanyRow) => {
    const next = c.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(`ระงับ ${c.name}? สมาชิกจะเข้าใช้งานไม่ได้ แต่ข้อมูลและเอกสารยังอยู่ครบ`)) return;
    run(() => api.patch(`/admin/companies/${c.id}`, { status: next }));
  };
  const removeAdmin = (c: CompanyRow, a: { userId: string; name: string }) => {
    if (window.confirm(`ถอด ${a.name} จากผู้ดูแล ${c.name}?`)) run(() => api.del(`/admin/companies/${c.id}/admins/${a.userId}`));
  };

  const quota = overview?.lineMessages.quota;
  return (
    <div>
      {overview && (
        <div className="stats">
          <div className="stat">
            <span className="num">{overview.companies.active ?? 0}</span>
            <span className="label">บริษัทที่ใช้งาน</span>
          </div>
          <div className="stat">
            <span className="num">{overview.companies.suspended ?? 0}</span>
            <span className="label">บริษัทที่ระงับ</span>
          </div>
          <div className="stat">
            <span className="num">{overview.registeredUsers}</span>
            <span className="label">ผู้ใช้ที่ลงทะเบียน</span>
          </div>
          <div className="stat">
            <span className="num">{overview.lineMessages.sentThisMonth}</span>
            <span className="label">
              ข้อความ LINE เดือนนี้
              {quota?.limit ? ` (OA ใช้ ${quota.used}/${quota.limit})` : ''}
            </span>
          </div>
        </div>
      )}
      {quota?.limit && quota.used / quota.limit > 0.8 && <div className="alert alert-warn">โควตาข้อความ LINE OA เดือนนี้ใช้ไปแล้วเกิน 80%</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <div className="row" style={{ marginBottom: 12, flexWrap: 'nowrap' }}>
        <input type="search" placeholder="ค้นหาชื่อบริษัทหรือเลขผู้เสียภาษี" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => setForm({ name: '', taxId: '', address: '' })}>
          + สร้างบริษัท
        </button>
      </div>

      {form && (
        <form className="card" onSubmit={save}>
          <h2>{form.id ? 'แก้ไขบริษัท' : 'สร้างบริษัท'}</h2>
          <label className="field">
            <span>
              ชื่อบริษัท <span className="req">*</span>
            </span>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="field">
            <span>เลขประจำตัวผู้เสียภาษี (13 หลัก)</span>
            <input type="text" inputMode="numeric" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
          </label>
          <label className="field">
            <span>ที่อยู่</span>
            <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
          <div className="row">
            <button className="btn-primary" type="submit">
              บันทึก
            </button>
            <button type="button" onClick={() => setForm(null)}>
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {rows.map((c) => (
        <div key={c.id} className="card">
          <div className="row between">
            <div>
              <strong>{c.name}</strong> <span className={`badge badge-${c.status}`}>{STATUS_LABEL[c.status]}</span>
              <div className="muted small">
                {c.taxId ?? 'ไม่มีเลขผู้เสียภาษี'} · สมาชิก {c.memberCount} · รออนุมัติ {c.pendingCount} · สร้าง {thaiDate(c.createdAt)}
              </div>
            </div>
            <div className="row">
              <Link className="btn btn-sm" to={`/c/${c.id}/admin`}>
                เปิดหลังบ้าน
              </Link>
              <button className="btn-sm" onClick={() => setForm({ id: c.id, name: c.name, taxId: c.taxId ?? '', address: c.address ?? '' })}>
                แก้ไข
              </button>
              <button className={`btn-sm ${c.status === 'active' ? 'btn-danger' : ''}`} onClick={() => toggle(c)}>
                {c.status === 'active' ? 'ระงับ' : 'เปิดใช้'}
              </button>
            </div>
          </div>
          <div className="row small" style={{ marginTop: 8 }}>
            <span className="muted">ผู้ดูแล:</span>
            {c.admins.length === 0 && <span className="badge badge-rejected">ยังไม่มีผู้ดูแล</span>}
            {c.admins.map((a) => (
              <span key={a.userId} className="badge badge-admin">
                {a.name}{' '}
                <button className="btn-ghost" style={{ minHeight: 0, padding: 0, color: 'inherit' }} onClick={() => removeAdmin(c, a)} aria-label={`ถอด ${a.name}`}>
                  ×
                </button>
              </span>
            ))}
            <button className="btn-sm btn-ghost" onClick={() => setAppointFor(c)}>
              + แต่งตั้ง
            </button>
          </div>
          {appointFor?.id === c.id && (
            <AppointAdmin
              onPick={(u) =>
                run(async () => {
                  await api.post(`/admin/companies/${c.id}/admins`, { userId: u.id });
                  setAppointFor(null);
                })
              }
              onClose={() => setAppointFor(null)}
            />
          )}
        </div>
      ))}
      {rows.length === 0 && <p className="muted center">ยังไม่มีบริษัท</p>}
    </div>
  );
}

function AppointAdmin({ onPick, onClose }: { onPick: (u: UserHit) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => api.get<UserHit[]>(`/admin/users?q=${encodeURIComponent(q)}`).then(setHits), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div style={{ marginTop: 10, padding: 12, background: '#fafafa', borderRadius: 10 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="search" autoFocus placeholder="ค้นหาผู้ใช้ที่ลงทะเบียนแล้ว (ชื่อ เบอร์ อีเมล)" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-sm" onClick={onClose}>
          ปิด
        </button>
      </div>
      {hits.map((u) => (
        <div key={u.id} className="list-item row between">
          <span>
            {[u.firstName, u.lastName].join(' ')} <span className="muted small">{u.phone}</span>
          </span>
          <button className="btn-sm btn-primary" onClick={() => onPick(u)}>
            แต่งตั้ง
          </button>
        </div>
      ))}
    </div>
  );
}

function SystemLog() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPage | null>(null);
  useEffect(() => {
    api.get<CompanyRow[]>('/admin/companies').then(setCompanies);
  }, []);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (companyId) p.set('companyId', companyId);
    if (from) p.set('from', bangkokDayStart(from));
    if (to) p.set('to', new Date(new Date(bangkokDayStart(to)).getTime() + 86400_000).toISOString());
    api.get<AuditPage>(`/admin/audit?${p}`).then(setData);
  }, [companyId, from, to, page]);
  return (
    <div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <label className="field">
          <span>บริษัท</span>
          <select value={companyId} onChange={(e) => (setCompanyId(e.target.value), setPage(1))}>
            <option value="">ทุกบริษัท</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>ตั้งแต่วันที่</span>
          <input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
        </label>
        <label className="field">
          <span>ถึงวันที่</span>
          <input type="date" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
        </label>
      </div>
      <AuditTable data={data} page={page} setPage={setPage} showCompany />
    </div>
  );
}
