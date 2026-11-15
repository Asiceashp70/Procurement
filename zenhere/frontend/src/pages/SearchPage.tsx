import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorText, type ListItem } from '../lib/api';
import { candidateName, DOC_BADGE, DOC_STATUS, type Candidate, type DocStatus } from '../lib/documents';
import { bangkokDayStart, thaiDate } from '../lib/thai';
import { useActiveMembership, useSession } from '../session';

interface Match {
  pageNo: number;
  source: 'pdf' | 'ocr' | null;
  confidence: number | null;
  snippet: { before: string; match: string; after: string } | null;
}
interface Hit {
  id: string;
  title: string;
  status: DocStatus;
  companyName: string;
  docType: string | null;
  tags: string[];
  pageCount: number;
  createdAt: string;
  completedAt: string | null;
  creatorName: string;
  textStatus: 'pending' | 'extracting' | 'ocr' | 'ready' | 'failed';
  titleHit: boolean;
  overdue: boolean;
  matchCount: number;
  matches: Match[];
}

const FILTER_KEYS = ['status', 'from', 'to', 'creatorId', 'signerId', 'departmentId', 'docType', 'tag', 'overdue'] as const;

/** SRC-01..05, SRC-08: search titles and the text of every page, including OCR. */
export function SearchPage() {
  const { me } = useSession();
  const m = useActiveMembership();
  const [params, setParams] = useSearchParams();
  const isAdmin = m?.role === 'admin' || me?.isSuperAdmin;
  const scope = params.get('scope') ?? 'mine';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [showFilters, setShowFilters] = useState(FILTER_KEYS.some((k) => params.get(k)));
  const [data, setData] = useState<{ items: Hit[]; hasMore: boolean; page: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<{ docTypes: string[]; tags: string[] }>({ docTypes: [], tags: [] });
  const [people, setPeople] = useState<Candidate[]>([]);
  const [departments, setDepartments] = useState<ListItem[]>([]);

  const companyId = m?.companyId;
  useEffect(() => {
    if (!companyId) return;
    const sp = new URLSearchParams({ scope });
    if (scope !== 'all') sp.set('companyId', companyId);
    api.get<{ docTypes: string[]; tags: string[] }>(`/search/facets?${sp}`).then(setFacets, () => undefined);
    api.get<Candidate[]>(`/companies/${companyId}/signer-candidates`).then(setPeople, () => undefined);
    api.get<ListItem[]>(`/companies/${companyId}/departments`).then(setDepartments, () => undefined);
  }, [companyId, scope]);

  useEffect(() => {
    const sp = new URLSearchParams(params);
    if (scope !== 'all' && companyId) sp.set('companyId', companyId);
    const hasQuery = (params.get('q') ?? '').trim() || FILTER_KEYS.some((k) => params.get(k));
    if (!hasQuery) {
      setData(null);
      return;
    }
    setError(null);
    api.get<{ items: Hit[]; hasMore: boolean; page: number }>(`/search?${sp}`).then(setData, (e) => setError(errorText(e)));
  }, [params, scope, companyId]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ q: q.trim() || null });
  };

  const query = params.get('q') ?? '';
  return (
    <div>
      <h1>ค้นหาเอกสาร</h1>
      <form onSubmit={submit} className="row" style={{ flexWrap: 'nowrap', marginBottom: 8 }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อเอกสาร หรือคำในเนื้อหา เช่น สัญญาจ้าง" autoFocus />
        <button className="btn-primary" type="submit">
          ค้นหา
        </button>
      </form>
      <div className="row" style={{ marginBottom: 12 }}>
        {(isAdmin || me?.isSuperAdmin) && (
          <div className="seg">
            <button className={scope === 'mine' ? 'active' : ''} onClick={() => set({ scope: null })}>
              ของฉัน
            </button>
            {isAdmin && (
              <button className={scope === 'company' ? 'active' : ''} onClick={() => set({ scope: 'company' })}>
                ทั้งบริษัท
              </button>
            )}
            {me?.isSuperAdmin && (
              <button className={scope === 'all' ? 'active' : ''} onClick={() => set({ scope: 'all' })}>
                ทุกบริษัท
              </button>
            )}
          </div>
        )}
        <button className="btn-sm" onClick={() => setShowFilters((s) => !s)}>
          ตัวกรอง {FILTER_KEYS.filter((k) => params.get(k)).length || ''}
        </button>
      </div>

      {showFilters && (
        <div className="card">
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <label className="field">
              <span>สถานะ</span>
              <select value={params.get('status') ?? ''} onChange={(e) => set({ status: e.target.value || null })}>
                <option value="">ทั้งหมด</option>
                {(Object.keys(DOC_STATUS) as DocStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {DOC_STATUS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ตั้งแต่วันที่</span>
              <input type="date" value={dayOf(params.get('from'))} onChange={(e) => set({ from: e.target.value ? bangkokDayStart(e.target.value) : null })} />
            </label>
            <label className="field">
              <span>ถึงวันที่</span>
              <input type="date" value={dayOf(params.get('to'), -1)} onChange={(e) => set({ to: e.target.value ? new Date(new Date(bangkokDayStart(e.target.value)).getTime() + 86400_000).toISOString() : null })} />
            </label>
            <label className="field">
              <span>ผู้สร้าง</span>
              <PersonSelect people={people} value={params.get('creatorId')} onChange={(v) => set({ creatorId: v })} />
            </label>
            <label className="field">
              <span>ผู้เซ็น</span>
              <PersonSelect people={people} value={params.get('signerId')} onChange={(v) => set({ signerId: v })} />
            </label>
            <label className="field">
              <span>แผนก (ผู้สร้าง)</span>
              <select value={params.get('departmentId') ?? ''} onChange={(e) => set({ departmentId: e.target.value || null })}>
                <option value="">ทั้งหมด</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ประเภท</span>
              <select value={params.get('docType') ?? ''} onChange={(e) => set({ docType: e.target.value || null })}>
                <option value="">ทั้งหมด</option>
                {facets.docTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>แท็ก</span>
              <select value={params.get('tag') ?? ''} onChange={(e) => set({ tag: e.target.value || null })}>
                <option value="">ทั้งหมด</option>
                {facets.tags.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="row between">
            <label className="checkbox small">
              <input type="checkbox" checked={params.get('overdue') === 'true'} onChange={(e) => set({ overdue: e.target.checked ? 'true' : null })} />
              <span>เฉพาะที่เลยกำหนด</span>
            </label>
            <button className="btn-sm btn-ghost" onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}>
              ล้างตัวกรอง
            </button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {!data && !error && <p className="muted center">พิมพ์คำค้น ระบบค้นทั้งชื่อเอกสารและข้อความทุกหน้า รวมถึงไฟล์สแกนที่อ่านด้วย OCR แล้ว</p>}
      {data?.items.length === 0 && <p className="muted center">ไม่พบเอกสาร</p>}
      {data?.items.map((d) => (
        <div key={d.id} className="card">
          <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <Link to={`/documents/${d.id}`} style={{ fontWeight: 700, flex: 1 }}>
              {d.title}
            </Link>
            <span className={`badge ${DOC_BADGE[d.status]}`}>{DOC_STATUS[d.status]}</span>
          </div>
          <div className="muted small">
            {scope === 'all' && `${d.companyName} · `}
            {d.creatorName} · {thaiDate(d.createdAt)} · {d.pageCount} หน้า
            {d.docType && ` · ${d.docType}`}
            {d.tags.length > 0 && ` · ${d.tags.map((t) => '#' + t).join(' ')}`}
          </div>
          {d.overdue && <span className="badge badge-rejected">เลยกำหนด</span>}
          {['pending', 'extracting', 'ocr'].includes(d.textStatus) && <div className="alert alert-info small" style={{ margin: '6px 0 0' }}>⏳ กำลังอ่านเอกสาร ค้นเนื้อหาได้เมื่ออ่านเสร็จ</div>}
          {d.matches.map((mt) => (
            <Link
              key={mt.pageNo}
              to={`/documents/${d.id}/view?page=${mt.pageNo}&q=${encodeURIComponent(query)}&pages=${d.matches.map((x) => x.pageNo).join(',')}`}
              className="list-item"
              style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
            >
              <span className="badge badge-admin">หน้า {mt.pageNo}</span>{' '}
              {mt.source === 'ocr' && (
                <span className="badge badge-pending" title="ข้อความจาก OCR อาจคลาดเคลื่อน">
                  จาก OCR{mt.confidence !== null ? ` · มั่นใจ ${Math.round(mt.confidence * 100)}%` : ''}
                </span>
              )}
              {mt.snippet && (
                <div className="small" style={{ marginTop: 4 }}>
                  {mt.snippet.before}
                  <mark>{mt.snippet.match}</mark>
                  {mt.snippet.after}
                </div>
              )}
            </Link>
          ))}
          {d.matchCount > d.matches.length && <div className="muted small">และอีก {d.matchCount - d.matches.length} หน้า</div>}
        </div>
      ))}
      {data && (data.page > 1 || data.hasMore) && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn-sm" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) })}>
            ก่อนหน้า
          </button>
          <span className="small">หน้า {data.page}</span>
          <button className="btn-sm" disabled={!data.hasMore} onClick={() => set({ page: String(data.page + 1) })}>
            ถัดไป
          </button>
        </div>
      )}
    </div>
  );
}

function PersonSelect({ people, value, onChange }: { people: Candidate[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">ทุกคน</option>
      {people.map((p) => (
        <option key={p.userId} value={p.userId}>
          {candidateName(p)}
        </option>
      ))}
    </select>
  );
}

/** ISO instant -> yyyy-mm-dd in Bangkok (shiftDays -1 shows the inclusive "to" day) */
function dayOf(iso: string | null, shiftDays = 0) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 7 * 3600_000 + shiftDays * 86400_000).toISOString().slice(0, 10);
}
