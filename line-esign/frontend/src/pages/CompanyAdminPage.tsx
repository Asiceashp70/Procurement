import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AuditTable, type AuditPage } from '../components/AuditTable';
import { api, errorText, type ListItem, type MembershipStatus } from '../lib/api';
import { bangkokDayStart, fullName, STATUS_LABEL, thaiDateTime } from '../lib/thai';

const TABS = [
  ['dashboard', 'ภาพรวม'],
  ['members', 'พนักงาน'],
  ['lists', 'แผนก/ตำแหน่ง'],
  ['invite', 'ลิงก์เชิญ'],
  ['import', 'นำเข้ารายชื่อ'],
  ['log', 'Log ผู้ดูแล'],
] as const;
type Tab = (typeof TABS)[number][0];

export function CompanyAdminPage() {
  const { companyId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'dashboard';
  const [name, setName] = useState('');
  const go = (t: Tab, extra: Record<string, string> = {}) => setParams({ tab: t, ...extra });

  return (
    <div>
      <div className="row between">
        <h1 style={{ margin: 0 }}>หลังบ้าน {name}</h1>
        <Link to="/" className="small">
          ← หน้าแรก
        </Link>
      </div>
      <nav className="tabs" style={{ marginTop: 12 }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => go(key)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'dashboard' && <Dashboard companyId={companyId!} onName={setName} go={go} />}
      {tab === 'members' && <Members companyId={companyId!} status={params.get('status') ?? 'pending'} notFriend={params.get('notFriend') === 'true'} />}
      {tab === 'lists' && (
        <div className="grid2">
          <ListEditor companyId={companyId!} kind="departments" title="แผนก" />
          <ListEditor companyId={companyId!} kind="positions" title="ตำแหน่ง" />
        </div>
      )}
      {tab === 'invite' && <Invite companyId={companyId!} />}
      {tab === 'import' && <Import companyId={companyId!} />}
      {tab === 'log' && <Log companyId={companyId!} />}
    </div>
  );
}

// --------------------------------------------------------------------------- ADM-08

interface DashboardData {
  company: { name: string; status: string };
  members: Record<MembershipStatus, number>;
  approvedNotOaFriend: number;
}

function Dashboard({ companyId, onName, go }: { companyId: string; onName: (n: string) => void; go: (t: Tab, extra?: Record<string, string>) => void }) {
  const [d, setD] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<DashboardData>(`/companies/${companyId}/dashboard`).then(
      (r) => {
        setD(r);
        onName(r.company.name);
      },
      (e) => setError(errorText(e)),
    );
  }, [companyId, onName]);
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!d) return <div className="loading">กำลังโหลด...</div>;
  const stat = (num: number, label: string, onClick: () => void) => (
    <button className="stat" onClick={onClick}>
      <span className="num">{num}</span>
      <span className="label">{label}</span>
    </button>
  );
  return (
    <>
      <div className="stats">
        {stat(d.members.pending, 'รออนุมัติ', () => go('members', { status: 'pending' }))}
        {stat(d.members.approved, 'พนักงานที่อนุมัติแล้ว', () => go('members', { status: 'approved' }))}
        {stat(d.approvedNotOaFriend, 'ยังไม่แอด LINE OA', () => go('members', { status: 'approved', notFriend: 'true' }))}
        {stat(d.members.suspended, 'ถูกระงับ', () => go('members', { status: 'suspended' }))}
      </div>
      <div className="alert alert-info small">สถิติเอกสาร (ตามสถานะ เลยกำหนด ผู้ที่ค้างเซ็นมากที่สุด) จะเพิ่มในเฟส 2</div>
    </>
  );
}

// --------------------------------------------------------------------------- ADM-04, ADM-06

interface Member {
  id: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  lineDisplayName: string | null;
  linePictureUrl: string | null;
  isOaFriend: boolean;
  employeeCode: string | null;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionName: string | null;
  role: 'admin' | 'member';
  status: MembershipStatus;
  canCreateDocuments: boolean;
  joinMethod: string;
  requestedAt: string;
  rejectReason: string | null;
}

function Members({ companyId, status, notFriend }: { companyId: string; status: string; notFriend: boolean }) {
  const [, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [lists, setLists] = useState<{ departments: ListItem[]; positions: ListItem[] }>({ departments: [], positions: [] });

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (status !== 'all') p.set('status', status);
    if (q) p.set('q', q);
    if (notFriend) p.set('notFriend', 'true');
    api.get<Member[]>(`/companies/${companyId}/members?${p}`).then(setRows, (e) => setError(errorText(e)));
  }, [companyId, status, q, notFriend]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    Promise.all([api.get<ListItem[]>(`/companies/${companyId}/departments`), api.get<ListItem[]>(`/companies/${companyId}/positions`)]).then(([departments, positions]) =>
      setLists({ departments, positions }),
    );
  }, [companyId]);

  const act = async (m: Member, body: Record<string, unknown>) => {
    setError(null);
    try {
      await api.patch(`/memberships/${m.id}`, body);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const reject = (m: Member) => {
    const reason = window.prompt(`เหตุผลที่ปฏิเสธ ${fullName(m)}`);
    if (reason?.trim()) act(m, { status: 'rejected', rejectReason: reason.trim() });
  };
  const suspend = (m: Member) => {
    if (window.confirm(`ระงับ ${fullName(m)}? คนที่ถูกระงับจะไม่อยู่ในรายชื่อผู้เซ็น`)) act(m, { status: 'suspended' });
  };

  return (
    <div>
      <div className="chips">
        {['pending', 'approved', 'suspended', 'rejected', 'all'].map((s) => (
          <button key={s} className={status === s ? 'active' : ''} onClick={() => setParams({ tab: 'members', status: s })}>
            {s === 'all' ? 'ทั้งหมด' : STATUS_LABEL[s]}
          </button>
        ))}
        <button className={notFriend ? 'active' : ''} onClick={() => setParams({ tab: 'members', status, ...(notFriend ? {} : { notFriend: 'true' }) })}>
          ยังไม่แอด OA
        </button>
      </div>
      <input type="search" placeholder="ค้นหาชื่อ รหัสพนักงาน เบอร์ แผนก" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {error && <div className="alert alert-error">{error}</div>}
      {!rows && <div className="loading">กำลังโหลด...</div>}
      {rows?.length === 0 && <p className="muted center">ไม่มีรายการ</p>}
      {rows?.map((m) => (
        <div key={m.id} className="card">
          <div className="row between">
            <div className="row">
              {m.linePictureUrl ? <img className="avatar" src={m.linePictureUrl} alt="" /> : <span className="avatar" />}
              <div>
                <strong>{fullName(m)}</strong> {m.nickname && <span className="muted">({m.nickname})</span>}
                <div className="muted small">
                  {m.employeeCode ?? '-'} · {m.departmentName ?? '-'} · {m.positionName ?? '-'}
                </div>
              </div>
            </div>
            <div className="row">
              {m.role === 'admin' && <span className="badge badge-admin">ผู้ดูแล</span>}
              <span className={`badge badge-${m.status}`}>{STATUS_LABEL[m.status]}</span>
            </div>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {m.phone} · {m.email} · {m.isOaFriend ? 'แอด OA แล้ว' : '⚠️ ยังไม่แอด OA'} · ขอเมื่อ {thaiDateTime(m.requestedAt)}
            {m.joinMethod === 'import' && ' · อนุมัติอัตโนมัติจากรายชื่อนำเข้า'}
          </div>
          {m.rejectReason && <div className="small">เหตุผลที่ปฏิเสธ: {m.rejectReason}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            {m.status === 'pending' && (
              <>
                <button className="btn-sm btn-primary" onClick={() => act(m, { status: 'approved' })}>
                  อนุมัติ
                </button>
                <button className="btn-sm btn-danger" onClick={() => reject(m)}>
                  ปฏิเสธ
                </button>
              </>
            )}
            {m.status === 'approved' && (
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={m.canCreateDocuments} onChange={(e) => act(m, { canCreateDocuments: e.target.checked })} />
                สิทธิ์สร้างเอกสาร
              </label>
            )}
            {(m.status === 'approved' || m.status === 'pending' || m.status === 'suspended') && (
              <button className="btn-sm" onClick={() => setEditing(m)}>
                แก้ไข
              </button>
            )}
            {m.status === 'approved' && (
              <button className="btn-sm btn-danger" onClick={() => suspend(m)}>
                ระงับ
              </button>
            )}
            {m.status === 'suspended' && (
              <button className="btn-sm" onClick={() => act(m, { status: 'approved' })}>
                เปิดใช้งานอีกครั้ง
              </button>
            )}
          </div>
        </div>
      ))}
      {editing && (
        <EditMember
          m={editing}
          lists={lists}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await act(editing, body);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditMember({
  m,
  lists,
  onClose,
  onSave,
}: {
  m: Member;
  lists: { departments: ListItem[]; positions: ListItem[] };
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [employeeCode, setEmployeeCode] = useState(m.employeeCode ?? '');
  const [departmentId, setDepartmentId] = useState(m.departmentId ?? '');
  const [positionId, setPositionId] = useState(m.positionId ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ employeeCode, departmentId: departmentId || null, positionId: positionId || null });
  };
  return (
    <dialog open style={{ position: 'fixed', top: '15%', zIndex: 50, boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
      <form onSubmit={submit}>
        <h2>แก้ไข {fullName(m)}</h2>
        <label className="field">
          <span>รหัสพนักงาน</span>
          <input type="text" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} required />
        </label>
        <label className="field">
          <span>แผนก</span>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">-</option>
            {lists.departments.filter((d) => d.isActive || d.id === m.departmentId).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>ตำแหน่ง</span>
          <select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">-</option>
            {lists.positions.filter((p) => p.isActive || p.id === m.positionId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button className="btn-primary" type="submit">
            บันทึก
          </button>
          <button type="button" onClick={onClose}>
            ยกเลิก
          </button>
        </div>
      </form>
    </dialog>
  );
}

// --------------------------------------------------------------------------- ADM-05

function ListEditor({ companyId, kind, title }: { companyId: string; kind: 'departments' | 'positions'; title: string }) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.get<ListItem[]>(`/companies/${companyId}/${kind}`).then(setItems), [companyId, kind]);
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    run(() => api.post(`/companies/${companyId}/${kind}`, { name, sortOrder: items.length }).then(() => setName('')));
  };
  return (
    <div className="card">
      <h2>{title}</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={add} className="row" style={{ flexWrap: 'nowrap', marginBottom: 8 }}>
        <input type="text" placeholder={`เพิ่ม${title}`} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" type="submit">
          เพิ่ม
        </button>
      </form>
      {items.map((it) => (
        <div key={it.id} className="list-item row between">
          <span style={{ opacity: it.isActive ? 1 : 0.45 }}>{it.name}</span>
          <div className="row">
            <button
              className="btn-sm btn-ghost"
              onClick={() => {
                const n = window.prompt(`แก้ชื่อ${title}`, it.name);
                if (n?.trim() && n !== it.name) run(() => api.patch(`/companies/${companyId}/${kind}/${it.id}`, { name: n }));
              }}
            >
              แก้ชื่อ
            </button>
            <button className="btn-sm" onClick={() => run(() => api.patch(`/companies/${companyId}/${kind}/${it.id}`, { isActive: !it.isActive }))}>
              {it.isActive ? 'ซ่อน' : 'ใช้อีกครั้ง'}
            </button>
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="muted small">ยังไม่มีรายการ ถ้าไม่มีเลย ฟอร์มลงทะเบียนจะไม่ถาม{title}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------- ADM-02

function Invite({ companyId }: { companyId: string }) {
  const [inv, setInv] = useState<{ code: string; link: string; rotatedAt: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ code: string; link: string; rotatedAt: string }>(`/companies/${companyId}/invite`).then(setInv, (e) => setError(errorText(e)));
  }, [companyId]);
  useEffect(() => {
    if (inv) QRCode.toDataURL(inv.link, { width: 440, margin: 1, errorCorrectionLevel: 'M' }).then(setQr);
  }, [inv]);
  const rotate = async () => {
    if (!window.confirm('สร้างรหัสและลิงก์ใหม่? รหัส ลิงก์ และ QR เดิมที่ติดประกาศไว้จะใช้ไม่ได้ทันที')) return;
    try {
      setInv(await api.post(`/companies/${companyId}/invite/rotate`));
    } catch (err) {
      setError(errorText(err));
    }
  };
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!inv) return <div className="loading">กำลังโหลด...</div>;
  return (
    <div className="card center stack">
      <p className="muted">ให้พนักงานสแกน QR หรือเปิดลิงก์ หรือกรอกรหัส 8 หลักในหน้า "เข้าร่วมบริษัท"</p>
      {qr && <img className="qr" src={qr} alt="QR สำหรับเข้าร่วมบริษัท" style={{ margin: '0 auto' }} />}
      <div className="code-big">{inv.code}</div>
      <div className="row" style={{ justifyContent: 'center', flexWrap: 'nowrap' }}>
        <input type="text" readOnly value={inv.link} onFocus={(e) => e.target.select()} />
        <button
          className="no-print"
          onClick={() =>
            navigator.clipboard.writeText(inv.link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
        </button>
      </div>
      <p className="muted small">สร้างเมื่อ {thaiDateTime(inv.rotatedAt)}</p>
      <div className="row no-print" style={{ justifyContent: 'center' }}>
        <button onClick={() => window.print()}>พิมพ์ประกาศ</button>
        <button className="btn-danger" onClick={rotate}>
          สร้างรหัสใหม่
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- ADM-07

interface ImportResult {
  inserted: number;
  updated: number;
  autoApproved: number;
  createdDepartments: string[];
  createdPositions: string[];
  errors: { row: number; message: string }[];
}
interface Imported {
  id: string;
  employeeCode: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  departmentName: string | null;
  positionName: string | null;
  canCreateDocuments: boolean;
  matchedMembershipId: string | null;
}

const TEMPLATE = '﻿รหัสพนักงาน,ชื่อ,นามสกุล,เบอร์โทร,แผนก,ตำแหน่ง,สิทธิ์สร้างเอกสาร\nE001,สมชาย,ใจดี,0812345678,บัญชี,เจ้าหน้าที่,ใช่\n';

function Import({ companyId }: { companyId: string }) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rows, setRows] = useState<Imported[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.get<Imported[]>(`/companies/${companyId}/employee-imports`).then(setRows), [companyId]);
  useEffect(() => {
    load();
  }, [load]);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setResult(await api.post<ImportResult>(`/companies/${companyId}/employee-imports`, fd));
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const templateUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;
  return (
    <div className="stack">
      <div className="card">
        <p className="small">
          นำเข้ารายชื่อพนักงานล่วงหน้าจากไฟล์ Excel (.xlsx) หรือ CSV เมื่อพนักงานลงทะเบียนด้วย<strong>รหัสพนักงานและเบอร์โทรตรงกัน</strong> ระบบจะอนุมัติให้เอง
          แผนกหรือตำแหน่งที่ยังไม่มีจะถูกสร้างให้อัตโนมัติ
        </p>
        <div className="row">
          <a className="btn" href={templateUrl} download="employee-template.csv">
            ดาวน์โหลดไฟล์ตัวอย่าง
          </a>
          <label className="btn btn-primary">
            {busy ? 'กำลังนำเข้า...' : 'เลือกไฟล์นำเข้า'}
            <input type="file" accept=".csv,.xlsx" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {result && (
        <div className="alert alert-ok">
          เพิ่ม {result.inserted} · อัปเดต {result.updated} · อนุมัติคำขอที่รออยู่อัตโนมัติ {result.autoApproved}
          {result.createdDepartments.length > 0 && <div>สร้างแผนกใหม่: {result.createdDepartments.join(', ')}</div>}
          {result.createdPositions.length > 0 && <div>สร้างตำแหน่งใหม่: {result.createdPositions.join(', ')}</div>}
          {result.errors.length > 0 && (
            <div style={{ color: '#8c1d18' }}>
              ข้ามแถวที่ผิด: {result.errors.map((e) => `แถว ${e.row} (${e.message})`).join(', ')}
            </div>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th>เบอร์</th>
                <th>แผนก / ตำแหน่ง</th>
                <th>สร้างเอกสาร</th>
                <th>ลงทะเบียนแล้ว</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employeeCode}</td>
                  <td>{[r.firstName, r.lastName].filter(Boolean).join(' ') || '-'}</td>
                  <td>{r.phone}</td>
                  <td>
                    {r.departmentName ?? '-'} / {r.positionName ?? '-'}
                  </td>
                  <td>{r.canCreateDocuments ? '✓' : ''}</td>
                  <td>{r.matchedMembershipId ? '✓' : <span className="muted">ยัง</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- ADM-09

function Log({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actorId, setActorId] = useState('');
  const [admins, setAdmins] = useState<Member[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPage | null>(null);
  useEffect(() => {
    api.get<Member[]>(`/companies/${companyId}/members?status=approved`).then((ms) => setAdmins(ms.filter((m) => m.role === 'admin')));
  }, [companyId]);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (from) p.set('from', bangkokDayStart(from));
    if (to) p.set('to', new Date(new Date(bangkokDayStart(to)).getTime() + 86400_000).toISOString());
    if (actorId) p.set('actorId', actorId);
    api.get<AuditPage>(`/companies/${companyId}/audit?${p}`).then(setData);
  }, [companyId, from, to, actorId, page]);
  return (
    <div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <label className="field">
          <span>ผู้ดูแล</span>
          <select value={actorId} onChange={(e) => (setActorId(e.target.value), setPage(1))}>
            <option value="">ทุกคน</option>
            {admins.map((a) => (
              <option key={a.userId} value={a.userId}>
                {fullName(a)}
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
      <AuditTable data={data} page={page} setPage={setPage} />
    </div>
  );
}
