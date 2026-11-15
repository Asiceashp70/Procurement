import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorText, type ListItem } from '../lib/api';
import { useSession } from '../session';

interface Lookup {
  companyId: string;
  name: string;
  departments: ListItem[];
  positions: ListItem[];
}

/** REG-02, REG-04: join by invite link (/join/:token) or 8-digit code (/join). */
export function JoinPage() {
  const { token } = useParams();
  const { refresh } = useSession();
  const [code, setCode] = useState('');
  const [company, setCompany] = useState<Lookup | null>(null);
  const [employeeCode, setEmployeeCode] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ status: string; companyName: string } | null>(null);

  useEffect(() => {
    if (token) api.get<Lookup>(`/companies/lookup?token=${encodeURIComponent(token)}`).then(setCompany, (e) => setError(errorText(e)));
  }, [token]);

  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setCompany(await api.get<Lookup>(`/companies/lookup?code=${code}`));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ status: string; companyName: string }>('/companies/join', {
        ...(token ? { token } : { code }),
        employeeCode,
        departmentId: departmentId || null,
        positionId: positionId || null,
      });
      setDone(r);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card center stack">
        <div style={{ fontSize: 40 }}>{done.status === 'approved' ? '✅' : '⏳'}</div>
        <h2>{done.status === 'approved' ? `เข้าร่วม ${done.companyName} แล้ว` : 'ส่งคำขอแล้ว'}</h2>
        <p className="muted">
          {done.status === 'approved' ? 'ข้อมูลของคุณตรงกับรายชื่อพนักงานที่บริษัทนำเข้าไว้ จึงอนุมัติให้ทันที' : 'รอผู้ดูแลบริษัทอนุมัติ ระบบจะแจ้งผลให้ทราบ'}
        </p>
        <Link className="btn btn-primary" to="/">
          กลับหน้าแรก
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>เข้าร่วมบริษัท</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {!company && !token && (
        <form onSubmit={lookup}>
          <label className="field">
            <span>รหัสเข้าร่วม 8 หลัก</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="code-big"
              style={{ fontSize: '1.5rem' }}
            />
          </label>
          <button className="btn-primary btn-block" disabled={code.length !== 8}>
            ค้นหาบริษัท
          </button>
        </form>
      )}
      {company && (
        <form onSubmit={join}>
          <div className="alert alert-info">
            บริษัท: <strong>{company.name}</strong>
          </div>
          <label className="field">
            <span>
              รหัสพนักงาน <span className="req">*</span>
            </span>
            <input type="text" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} required maxLength={50} />
          </label>
          {company.departments.length > 0 && (
            <label className="field">
              <span>
                แผนก <span className="req">*</span>
              </span>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
                <option value="">เลือกแผนก</option>
                {company.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {company.positions.length > 0 && (
            <label className="field">
              <span>
                ตำแหน่ง <span className="req">*</span>
              </span>
              <select value={positionId} onChange={(e) => setPositionId(e.target.value)} required>
                <option value="">เลือกตำแหน่ง</option>
                {company.positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="btn-primary btn-block" disabled={busy || !employeeCode.trim()}>
            {busy ? 'กำลังส่ง...' : 'ส่งคำขอเข้าร่วม'}
          </button>
        </form>
      )}
    </div>
  );
}
