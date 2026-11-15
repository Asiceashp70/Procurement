import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FieldBox } from '../components/FieldBox';
import { PdfPages } from '../components/PdfPages';
import { api, ApiError, errorText } from '../lib/api';
import {
  candidateName,
  FIELD_ICON,
  FIELD_LABEL,
  FIELD_SIZE,
  SIGNER_COLORS,
  type Candidate,
  type DocDetail,
  type EditorField,
  type FieldType,
} from '../lib/documents';
import { displaySize, type PageInfo } from '../lib/pdf';
import { useSession } from '../session';

interface SignerRow {
  userId: string;
  order: number;
  name: string;
}

const TYPES: FieldType[] = ['signature', 'date', 'text', 'checkbox', 'stamp', 'certified_copy'];
const uuid = () => crypto.randomUUID();

/** Bangkok calendar day <-> end of that day as an instant */
const dueToDay = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : '');
const dayToDue = (day: string) => new Date(`${day}T23:59:00+07:00`).toISOString();

/** DOC-03..07: place fields, choose signers and order, set the due date, then send. */
export function EditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me } = useSession();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [signers, setSigners] = useState<SignerRow[]>([]);
  const [fields, setFields] = useState<EditorField[]>([]);
  const [activeSigner, setActiveSigner] = useState<string | null>(null);
  const [placing, setPlacing] = useState<FieldType | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [title, setTitle] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [mode, setMode] = useState<'sequential' | 'parallel'>('sequential');
  const [notifyOnSign, setNotifyOnSign] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    api.get<DocDetail>(`/documents/${id}`).then(
      (d) => {
        if (d.status !== 'draft') return navigate(`/documents/${id}`, { replace: true });
        setDoc(d);
        setTitle(d.title);
        setDueDay(dueToDay(d.dueAt));
        setMode(d.signingMode);
        setNotifyOnSign(d.notifyCreatorOnSign);
        const rows = d.signers.map((s) => ({ userId: s.userId, order: s.order, name: candidateName(s) }));
        setSigners(rows);
        setActiveSigner(rows[0]?.userId ?? null);
        setFields(d.fields.map((f) => ({ ...f, settings: f.settings ?? {} })));
        loaded.current = true;
      },
      (e) => setError(errorText(e)),
    );
  }, [id, navigate]);

  // ---------------------------------------------------------------- autosave
  const layout = useMemo(() => ({ signers: signers.map((s) => ({ userId: s.userId, order: s.order })), fields }), [signers, fields]);
  const saveLayout = useCallback(async () => {
    setSaveState('saving');
    try {
      await api.put(`/documents/${id}/layout`, layout);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      setError(errorText(err));
      throw err;
    }
  }, [id, layout]);
  useEffect(() => {
    if (!loaded.current) return;
    setSaveState('dirty');
    const t = setTimeout(() => saveLayout().catch(() => undefined), 700);
    return () => clearTimeout(t);
  }, [layout, saveLayout]);

  const saveMeta = useCallback(
    (patch: Record<string, unknown>) => api.patch(`/documents/${id}`, patch).catch((e) => setError(errorText(e))),
    [id],
  );

  // ---------------------------------------------------------------- signers
  const colorOf = (userId: string) => SIGNER_COLORS[Math.max(0, signers.findIndex((s) => s.userId === userId)) % SIGNER_COLORS.length];
  const addSigner = (c: Candidate) => {
    if (signers.some((s) => s.userId === c.userId)) return;
    const order = mode === 'parallel' ? 1 : Math.max(0, ...signers.map((s) => s.order)) + 1;
    setSigners([...signers, { userId: c.userId, order, name: candidateName(c) }]);
    setActiveSigner(c.userId);
  };
  const removeSigner = (userId: string) => {
    const n = fields.filter((f) => f.signerUserId === userId).length;
    if (n && !window.confirm(`ลบผู้เซ็นคนนี้และกรอบของเขา ${n} กรอบ?`)) return;
    setSigners(signers.filter((s) => s.userId !== userId));
    setFields(fields.filter((f) => f.signerUserId !== userId));
    if (activeSigner === userId) setActiveSigner(signers.find((s) => s.userId !== userId)?.userId ?? null);
  };

  // ---------------------------------------------------------------- fields
  const place = (page: PageInfo, e: React.PointerEvent<HTMLDivElement>) => {
    if (!placing) {
      setSelected(null);
      return;
    }
    if (!activeSigner) {
      setError('เลือกหรือเพิ่มผู้เซ็นก่อนวางกรอบ');
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const d = displaySize(page);
    const w = Math.min(0.9, FIELD_SIZE[placing].w / d.width);
    const h = Math.min(0.9, FIELD_SIZE[placing].h / d.height);
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    const f: EditorField = {
      id: uuid(),
      signerUserId: activeSigner,
      pageNo: page.pageNo,
      type: placing,
      x: Math.min(1 - w, Math.max(0, cx - w / 2)),
      y: Math.min(1 - h, Math.max(0, cy - h / 2)),
      w,
      h,
      settings: placing === 'text' ? { required: true } : placing === 'certified_copy' ? { text: 'สำเนาถูกต้อง' } : {},
    };
    setFields((fs) => [...fs, f]);
    setSelected(f.id);
    setPlacing(null);
  };
  const update = (fid: string, patch: Partial<EditorField>) => setFields((fs) => fs.map((f) => (f.id === fid ? { ...f, ...patch } : f)));
  const sel = fields.find((f) => f.id === selected) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        setFields((fs) => fs.filter((f) => f.id !== selected));
        setSelected(null);
      }
      if (e.key === 'Escape') setPlacing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // ---------------------------------------------------------------- send
  const send = async () => {
    setProblems([]);
    setError(null);
    setSending(true);
    try {
      await saveLayout();
      await api.patch(`/documents/${id}`, { title, dueAt: dueDay ? dayToDue(dueDay) : null, signingMode: mode, notifyCreatorOnSign: notifyOnSign });
      await api.post(`/documents/${id}/send`);
      navigate(`/documents/${id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setProblems(err.problems ?? []);
      setError(errorText(err));
      setSending(false);
    }
  };

  const del = async () => {
    if (!window.confirm('ลบฉบับร่างนี้?')) return;
    await api.del(`/documents/${id}`);
    navigate('/documents?box=drafts', { replace: true });
  };

  if (error && !doc) return <div className="alert alert-error">{error}</div>;
  if (!doc) return <div className="loading">กำลังโหลด...</div>;
  const counts = new Map<string, number>();
  fields.forEach((f) => counts.set(f.signerUserId, (counts.get(f.signerUserId) ?? 0) + 1));
  const todayDay = dueToDay(new Date().toISOString());

  return (
    <div className="editor">
      <aside className="stack">
        <div className="card">
          <label className="field">
            <span>ชื่อเรื่อง</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && saveMeta({ title })} maxLength={200} />
          </label>
          <label className="field">
            <span>วันครบกำหนด</span>
            <input type="date" min={todayDay} value={dueDay} onChange={(e) => (setDueDay(e.target.value), e.target.value && saveMeta({ dueAt: dayToDue(e.target.value) }))} />
          </label>
          <div className="seg" style={{ marginBottom: 8 }}>
            <button className={mode === 'sequential' ? 'active' : ''} onClick={() => (setMode('sequential'), saveMeta({ signingMode: 'sequential' }))}>
              เรียงลำดับ
            </button>
            <button
              className={mode === 'parallel' ? 'active' : ''}
              onClick={() => {
                setMode('parallel');
                setSigners((ss) => ss.map((s) => ({ ...s, order: 1 })));
                saveMeta({ signingMode: 'parallel' });
              }}
            >
              พร้อมกัน
            </button>
          </div>
          <label className="checkbox small">
            <input type="checkbox" checked={notifyOnSign} onChange={(e) => (setNotifyOnSign(e.target.checked), saveMeta({ notifyCreatorOnSign: e.target.checked }))} />
            <span>แจ้งฉันทาง LINE ทุกครั้งที่มีคนเซ็น</span>
          </label>
        </div>

        <div className="card">
          <h3>ผู้เซ็น</h3>
          {mode === 'sequential' && <p className="muted small">ลำดับเดียวกันเซ็นพร้อมกันได้</p>}
          {signers.map((s) => (
            <div key={s.userId} className="list-item row" style={{ flexWrap: 'nowrap' }}>
              <input type="radio" name="active" checked={activeSigner === s.userId} onChange={() => setActiveSigner(s.userId)} aria-label={`วางกรอบให้ ${s.name}`} />
              <span className="dot" style={{ background: colorOf(s.userId) }} />
              <span style={{ flex: 1 }} className="small">
                {s.name} <span className="muted">({counts.get(s.userId) ?? 0} กรอบ)</span>
              </span>
              {mode === 'sequential' && (
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={s.order}
                  style={{ width: 56, minHeight: 34 }}
                  aria-label="ลำดับ"
                  onChange={(e) => setSigners(signers.map((x) => (x.userId === s.userId ? { ...x, order: Math.max(1, Number(e.target.value) || 1) } : x)))}
                />
              )}
              <button className="btn-sm btn-ghost" onClick={() => removeSigner(s.userId)} aria-label="ลบ">
                ✕
              </button>
            </div>
          ))}
          <SignerPicker companyId={doc.companyId} exclude={signers.map((s) => s.userId)} onPick={addSigner} selfId={me?.id} />
        </div>

        {sel && (
          <FieldSettingsPanel
            f={sel}
            signers={signers}
            companyId={doc.companyId}
            pageCount={doc.pageCount}
            onChange={(patch) => update(sel.id, patch)}
            onDuplicate={() => {
              const copy = { ...sel, id: uuid(), x: Math.min(1 - sel.w, sel.x + 0.02), y: Math.min(1 - sel.h, sel.y + 0.02) };
              setFields((fs) => [...fs, copy]);
              setSelected(copy.id);
            }}
            onAllPages={() => {
              const others = doc.pages.filter((p) => p.pageNo !== sel.pageNo).map((p) => ({ ...sel, id: uuid(), pageNo: p.pageNo }));
              setFields((fs) => [...fs, ...others]);
            }}
            onDelete={() => {
              setFields((fs) => fs.filter((f) => f.id !== sel.id));
              setSelected(null);
            }}
          />
        )}

        <div className="card stack">
          {problems.length > 0 && (
            <div className="alert alert-error small">
              {problems.map((p) => (
                <div key={p}>• {p}</div>
              ))}
            </div>
          )}
          {error && problems.length === 0 && <div className="alert alert-error small">{error}</div>}
          <button className="btn-primary btn-block" onClick={send} disabled={sending}>
            {sending ? 'กำลังส่ง...' : 'ตรวจและส่งเอกสาร'}
          </button>
          <div className="row between small">
            <span className="muted">{saveState === 'saved' ? '✓ บันทึกร่างแล้ว' : saveState === 'error' ? 'บันทึกไม่สำเร็จ' : 'กำลังบันทึก...'}</span>
            <button className="btn-sm btn-ghost btn-danger" onClick={del}>
              ลบร่าง
            </button>
          </div>
          <Link to={`/documents?box=drafts`} className="small">
            ← กลับไปรายการ
          </Link>
        </div>
      </aside>

      <section>
        <div className="sticky-top">
          <div className="palette">
            {TYPES.map((t) => (
              <button key={t} className={placing === t ? 'active' : ''} onClick={() => setPlacing(placing === t ? null : t)} disabled={!activeSigner}>
                {FIELD_ICON[t]} {FIELD_LABEL[t]}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button className="btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="ย่อ">
              −
            </button>
            <button className="btn-sm" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button className="btn-sm" onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))} aria-label="ขยาย">
              +
            </button>
          </div>
          {placing && (
            <div className="alert alert-info small" style={{ margin: '8px 0 0' }}>
              แตะบนหน้าเอกสารเพื่อวาง{FIELD_LABEL[placing]} ให้ {signers.find((s) => s.userId === activeSigner)?.name}
            </div>
          )}
          {!signers.length && <div className="alert alert-warn small" style={{ margin: '8px 0 0' }}>เพิ่มผู้เซ็นทางซ้ายก่อน แล้วจึงวางกรอบ</div>}
        </div>
        <div className="pdf-scroller" style={{ cursor: placing ? 'crosshair' : 'default' }}>
          <PdfPages
            url={`/api/documents/${id}/file?v=source`}
            pages={doc.pages}
            zoom={zoom}
            overlay={(page, size) => (
              <div style={{ position: 'absolute', inset: 0 }} onPointerDown={(e) => place(page, e)}>
                {fields
                  .filter((f) => f.pageNo === page.pageNo)
                  .map((f) => (
                    <FieldBox key={f.id} g={f} color={colorOf(f.signerUserId)} selected={selected === f.id} pageSize={size} onSelect={() => setSelected(f.id)} onChange={(g) => update(f.id, g)}>
                      {f.h * size.height < 26 || f.w * size.width < 40 ? (
                        <span title={FIELD_LABEL[f.type]}>{FIELD_ICON[f.type]}</span>
                      ) : (
                        <span style={{ fontSize: Math.max(8, Math.min(11, f.h * size.height * 0.3)) }}>
                          <span className="fc">
                            {FIELD_ICON[f.type]} {f.type === 'text' && f.settings.label ? f.settings.label : FIELD_LABEL[f.type]}
                          </span>
                          <span className="fc">{signers.find((s) => s.userId === f.signerUserId)?.name.split(' ')[0]}</span>
                        </span>
                      )}
                    </FieldBox>
                  ))}
              </div>
            )}
          />
        </div>
      </section>
    </div>
  );
}

function SignerPicker({ companyId, exclude, onPick, selfId }: { companyId: string; exclude: string[]; onPick: (c: Candidate) => void; selfId?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Candidate[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => api.get<Candidate[]>(`/companies/${companyId}/signer-candidates?q=${encodeURIComponent(q)}`).then(setHits), 200);
    return () => clearTimeout(t);
  }, [q, open, companyId]);
  if (!open)
    return (
      <button className="btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        + เพิ่มผู้เซ็น
      </button>
    );
  return (
    <div style={{ marginTop: 8 }}>
      <input type="search" autoFocus placeholder="ค้นหาชื่อ รหัส หรือแผนก" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {hits
          .filter((c) => !exclude.includes(c.userId))
          .map((c) => (
            <button key={c.userId} className="btn-ghost" style={{ display: 'flex', width: '100%', justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left', fontWeight: 400 }} onClick={() => onPick(c)}>
              <span>
                {candidateName(c)} {c.userId === selfId && <span className="badge badge-admin">ฉัน</span>}
                <br />
                <span className="muted small">
                  {[c.employeeCode, c.departmentName, c.positionName].filter(Boolean).join(' · ')}
                  {!c.isOaFriend && ' · ⚠️ ยังไม่แอด OA'}
                </span>
              </span>
            </button>
          ))}
      </div>
      <button className="btn-sm btn-ghost" onClick={() => setOpen(false)}>
        ปิด
      </button>
    </div>
  );
}

function FieldSettingsPanel({
  f,
  signers,
  companyId,
  pageCount,
  onChange,
  onDuplicate,
  onAllPages,
  onDelete,
}: {
  f: EditorField;
  signers: SignerRow[];
  companyId: string;
  pageCount: number;
  onChange: (p: Partial<EditorField>) => void;
  onDuplicate: () => void;
  onAllPages: () => void;
  onDelete: () => void;
}) {
  const [stamps, setStamps] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (f.type === 'stamp') api.get<{ id: string; name: string }[]>(`/companies/${companyId}/stamps?forUserId=${f.signerUserId}`).then(setStamps, () => setStamps([]));
  }, [f.type, f.signerUserId, companyId]);
  const set = (s: Partial<EditorField['settings']>) => onChange({ settings: { ...f.settings, ...s } });
  return (
    <div className="card">
      <h3>
        {FIELD_ICON[f.type]} {FIELD_LABEL[f.type]} (หน้า {f.pageNo})
      </h3>
      <label className="field">
        <span>ผู้กรอก</span>
        <select value={f.signerUserId} onChange={(e) => onChange({ signerUserId: e.target.value })}>
          {signers.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {(f.type === 'text' || f.type === 'checkbox') && (
        <label className="field">
          <span>ป้ายกำกับ</span>
          <input type="text" value={f.settings.label ?? ''} onChange={(e) => set({ label: e.target.value })} maxLength={100} />
        </label>
      )}
      {(f.type === 'text' || f.type === 'checkbox') && (
        <label className="checkbox small" style={{ marginBottom: 10 }}>
          <input type="checkbox" checked={f.type === 'text' ? f.settings.required !== false : f.settings.required === true} onChange={(e) => set({ required: e.target.checked })} />
          <span>บังคับกรอก</span>
        </label>
      )}
      {f.type === 'text' && (
        <div className="grid2">
          <label className="field">
            <span>ความยาวสูงสุด</span>
            <input type="number" min={1} max={1000} value={f.settings.maxLength ?? ''} onChange={(e) => set({ maxLength: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
          <label className="field">
            <span>ขนาดตัวอักษร</span>
            <input type="number" min={6} max={36} value={f.settings.fontSize ?? 12} onChange={(e) => set({ fontSize: Number(e.target.value) || 12 })} />
          </label>
        </div>
      )}
      {(f.type === 'date' || f.type === 'certified_copy') && (
        <label className="field">
          <span>รูปแบบวันที่</span>
          <select value={f.settings.dateFormat ?? 'short'} onChange={(e) => set({ dateFormat: e.target.value as 'short' })}>
            <option value="short">15 พ.ย. 2569</option>
            <option value="long">15 พฤศจิกายน 2569</option>
            <option value="numeric">15/11/2569</option>
          </select>
        </label>
      )}
      {f.type === 'certified_copy' && (
        <label className="field">
          <span>ข้อความ</span>
          <input type="text" value={f.settings.text ?? 'สำเนาถูกต้อง'} onChange={(e) => set({ text: e.target.value })} maxLength={60} />
        </label>
      )}
      {f.type === 'stamp' && (
        <label className="field">
          <span>ตราที่ใช้</span>
          <select value={f.settings.stampId ?? ''} onChange={(e) => set({ stampId: e.target.value || undefined })}>
            <option value="">เลือกตรา</option>
            {stamps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {stamps.length === 0 && <div className="field-error">ผู้กรอกคนนี้ไม่มีสิทธิ์ใช้ตราใดเลย</div>}
        </label>
      )}
      <div className="row">
        <button className="btn-sm" onClick={onDuplicate}>
          คัดลอก
        </button>
        {f.type === 'certified_copy' && pageCount > 1 && (
          <button className="btn-sm" onClick={onAllPages}>
            วางทุกหน้า
          </button>
        )}
        <button className="btn-sm btn-danger" onClick={onDelete}>
          ลบ
        </button>
      </div>
    </div>
  );
}
