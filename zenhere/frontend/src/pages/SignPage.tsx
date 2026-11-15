import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PdfPages } from '../components/PdfPages';
import { DrawPad } from '../components/SignatureEditor';
import { api, ApiError, errorText } from '../lib/api';
import { FIELD_LABEL, todayThai, type FieldSettings, type FieldType, type SignerStatus } from '../lib/documents';
import type { PageInfo } from '../lib/pdf';
import { thaiDateTime } from '../lib/thai';

interface SignField {
  id: string;
  pageNo: number;
  type: FieldType;
  x: number;
  y: number;
  w: number;
  h: number;
  mine: boolean;
  settings: FieldSettings;
  filled: boolean;
}

interface SigningContext {
  id: string;
  companyId: string;
  title: string;
  status: string;
  dueAt: string | null;
  overdue: boolean;
  senderName: string;
  pages: PageInfo[];
  mySigner: { id: string; status: SignerStatus; signedAt: string | null } | null;
  canSign: boolean;
  waitingFor: string[];
  savedSignatureId: string | null;
  stamps: { id: string; name: string }[];
  fields: SignField[];
}

type SigChoice = { kind: 'saved'; url: string } | { kind: 'once'; url: string; blob: Blob };

/** SGN-01..05, SGN-10: sign on one page on the phone. */
export function SignPage() {
  const { id } = useParams();
  const [ctx, setCtx] = useState<SigningContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [sig, setSig] = useState<SigChoice | null>(null);
  const [sigModal, setSigModal] = useState(false);
  const [textField, setTextField] = useState<SignField | null>(null);
  const [consent, setConsent] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [done, setDone] = useState<'signed' | 'declined' | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<SigningContext>(`/documents/${id}/signing`).then(setCtx, (e) => setError(errorText(e)));
  }, [id]);

  if (error && !ctx) return <div className="alert alert-error">{error}</div>;
  if (!ctx) return <div className="loading">กำลังโหลดเอกสาร...</div>;

  const mine = ctx.fields.filter((f) => f.mine);
  const isFilled = (f: SignField) => {
    switch (f.type) {
      case 'signature':
      case 'certified_copy':
        return Boolean(sig);
      case 'date':
        return true;
      case 'text':
        return typeof values[f.id] === 'string' && (values[f.id] as string).trim() !== '';
      case 'checkbox':
        return values[f.id] === true;
      case 'stamp':
        return values[f.id] === true;
    }
  };
  const isRequired = (f: SignField) => (f.type === 'text' ? f.settings.required !== false : f.type === 'checkbox' ? f.settings.required === true : f.type !== 'date');
  const remaining = mine.filter((f) => isRequired(f) && !isFilled(f));

  const scrollTo = (f: SignField) => {
    const page = scroller.current?.querySelector(`[data-page="${f.pageNo}"]`) as HTMLElement | null;
    if (!page) return;
    const top = page.getBoundingClientRect().top + window.scrollY + f.y * page.offsetHeight - window.innerHeight / 3;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  const tap = (f: SignField) => {
    if (!ctx.canSign) return;
    setMissing((m) => {
      const n = new Set(m);
      n.delete(f.id);
      return n;
    });
    if (f.type === 'signature' || f.type === 'certified_copy') setSigModal(true);
    else if (f.type === 'text') setTextField(f);
    else if (f.type === 'checkbox' || f.type === 'stamp') setValues((v) => ({ ...v, [f.id]: v[f.id] !== true }));
  };

  const confirm = async () => {
    if (remaining.length) {
      // SGN-10: pressing with gaps jumps to the first missing field
      setMissing(new Set(remaining.map((f) => f.id)));
      scrollTo(remaining[0]);
      return;
    }
    if (!consent) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('payload', JSON.stringify({ values, useSavedSignature: sig?.kind !== 'once', consent: true }));
      if (sig?.kind === 'once') fd.append('signature', sig.blob, 'signature.png');
      await api.post(`/documents/${id}/sign`, fd);
      setDone('signed');
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.missing?.length) {
        setMissing(new Set(err.missing));
        const first = mine.find((f) => err.missing!.includes(f.id));
        if (first) scrollTo(first);
      }
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card center stack">
        <div style={{ fontSize: 48 }}>{done === 'signed' ? '✅' : '🚫'}</div>
        <h2>{done === 'signed' ? 'ลงนามเรียบร้อย' : 'ปฏิเสธการเซ็นแล้ว'}</h2>
        <p className="muted">{done === 'signed' ? 'เมื่อทุกคนเซ็นครบ ระบบจะแจ้งเตือนพร้อมลิงก์ไฟล์ฉบับสมบูรณ์' : 'ระบบแจ้งผู้ส่งเอกสารพร้อมเหตุผลแล้ว'}</p>
        <Link className="btn" to={`/documents/${id}`}>
          ดูสถานะเอกสาร
        </Link>
        <Link to="/documents">กลับไปรายการเอกสาร</Link>
      </div>
    );
  }

  const stampName = (sid?: string) => ctx.stamps.find((s) => s.id === sid);
  return (
    <div>
      <div className="card" style={{ marginBottom: 8 }}>
        <h1 style={{ marginBottom: 4 }}>{ctx.title}</h1>
        <div className="muted small">
          จาก {ctx.senderName}
          {ctx.dueAt && ` · กำหนด ${thaiDateTime(ctx.dueAt)}`}
          {ctx.overdue && <span className="badge badge-rejected" style={{ marginLeft: 6 }}>เลยกำหนด</span>}
        </div>
        <SignState ctx={ctx} />
      </div>

      {ctx.canSign && (
        <div className="sticky-top row between" style={{ flexWrap: 'nowrap' }}>
          <strong>{remaining.length ? `เหลือ ${remaining.length} จุด` : 'กรอกครบแล้ว ✓'}</strong>
          {remaining.length > 0 && (
            <button className="btn-sm btn-primary" onClick={() => scrollTo(remaining[0])}>
              ไปจุดถัดไป ↓
            </button>
          )}
        </div>
      )}

      <div className="pdf-scroller" ref={scroller}>
        <PdfPages
          url={`/api/documents/${id}/file?v=source`}
          pages={ctx.pages}
          onReady={() => ctx.canSign && remaining[0] && setTimeout(() => scrollTo(remaining[0]), 300)}
          overlay={(page, size) =>
            ctx.fields
              .filter((f) => f.pageNo === page.pageNo)
              .map((f) => {
                // text scales with the box so it fits on a phone screen
                const fontSize = Math.max(7, Math.min(15, f.h * size.height * 0.55));
                const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, fontSize };
                if (!f.mine) return <div key={f.id} className="field-box other" style={style} title="ช่องของผู้เซ็นคนอื่น" />;
                const filled = isFilled(f);
                return (
                  <div
                    key={f.id}
                    role="button"
                    tabIndex={0}
                    aria-label={FIELD_LABEL[f.type]}
                    className={`field-box mine ${filled ? 'filled' : ''} ${missing.has(f.id) ? 'missing' : ''}`}
                    style={{ ...style, ['--c' as string]: '#06C755', pointerEvents: ctx.canSign ? 'auto' : 'none' }}
                    onClick={() => tap(f)}
                  >
                    <FieldContent f={f} sig={sig} value={values[f.id]} stampUrl={f.settings.stampId && stampName(f.settings.stampId) ? `/api/companies/${ctx.companyId}/stamps/${f.settings.stampId}/image` : null} />
                  </div>
                );
              })
          }
        />
      </div>

      {ctx.canSign && (
        <div className="sticky-bottom stack">
          {error && <div className="alert alert-error small">{error}</div>}
          <label className="checkbox small">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>ข้าพเจ้ายินยอมลงนามด้วยวิธีการทางอิเล็กทรอนิกส์ และยอมรับว่ามีผลเช่นเดียวกับการลงลายมือชื่อ</span>
          </label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn-danger" onClick={() => setDeclining(true)}>
              ปฏิเสธ
            </button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={confirm} disabled={busy || (!consent && remaining.length === 0)}>
              {busy ? 'กำลังลงนาม...' : 'ยืนยันการลงนาม'}
            </button>
          </div>
        </div>
      )}

      {sigModal && (
        <SignatureModal
          savedId={ctx.savedSignatureId}
          current={sig}
          onClose={() => setSigModal(false)}
          onPick={(c) => {
            setSig(c);
            setSigModal(false);
          }}
        />
      )}
      {textField && (
        <TextModal
          f={textField}
          value={(values[textField.id] as string) ?? ''}
          onClose={() => setTextField(null)}
          onSave={(v) => {
            setValues((vals) => ({ ...vals, [textField.id]: v }));
            setTextField(null);
          }}
        />
      )}
      {declining && <DeclineModal id={id!} onClose={() => setDeclining(false)} onDone={() => setDone('declined')} />}
    </div>
  );
}

function SignState({ ctx }: { ctx: SigningContext }) {
  if (ctx.canSign) return <div className="alert alert-ok small" style={{ margin: '8px 0 0' }}>แตะช่องสีเขียวเพื่อกรอก แล้วกดยืนยันการลงนามด้านล่าง</div>;
  let text = 'คุณดูเอกสารนี้ได้ แต่ไม่ได้เป็นผู้เซ็น';
  if (ctx.status === 'voided') text = 'เอกสารนี้ถูกยกเลิกแล้ว';
  else if (ctx.status === 'declined') text = 'เอกสารนี้ถูกปฏิเสธแล้ว';
  else if (ctx.mySigner?.status === 'signed') text = `คุณเซ็นแล้วเมื่อ ${thaiDateTime(ctx.mySigner.signedAt)}`;
  else if (ctx.mySigner?.status === 'waiting') text = `ยังไม่ถึงลำดับของคุณ กำลังรอ ${ctx.waitingFor.join(', ')}`;
  else if (ctx.status === 'completed') text = 'เอกสารนี้เซ็นครบแล้ว';
  return (
    <div className="alert alert-info small" style={{ margin: '8px 0 0' }}>
      {text} · <Link to={`/documents/${ctx.id}`}>ดูสถานะ</Link>
    </div>
  );
}

function FieldContent({ f, sig, value, stampUrl }: { f: SignField; sig: SigChoice | null; value: string | boolean | undefined; stampUrl: string | null }) {
  switch (f.type) {
    case 'signature':
      return sig ? <img src={sig.url} alt="ลายเซ็น" /> : <span className="fc">✍️ แตะเพื่อเซ็น</span>;
    case 'certified_copy':
      return (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', justifyContent: 'space-around' }}>
          <strong style={{ fontSize: '0.75em' }}>{f.settings.text || 'สำเนาถูกต้อง'}</strong>
          {sig ? <img src={sig.url} alt="" style={{ maxHeight: '50%' }} /> : <span>✍️ แตะเพื่อเซ็น</span>}
          <span style={{ fontSize: '0.7em' }}>{todayThai(f.settings.dateFormat)}</span>
        </span>
      );
    case 'date':
      return <span className="fc">{todayThai(f.settings.dateFormat)}</span>;
    case 'text':
      return typeof value === 'string' && value ? <span className="fc" style={{ color: '#111' }}>{value}</span> : <span className="fc">🔤 {f.settings.label || 'แตะเพื่อกรอก'}</span>;
    case 'checkbox':
      return <span style={{ fontSize: '1.3em', lineHeight: 1, color: '#111' }}>{value === true ? '✓' : ''}</span>;
    case 'stamp':
      return value === true && stampUrl ? <img src={stampUrl} alt="ตราประทับ" /> : <span className="fc">🔴 แตะเพื่อประทับตรา</span>;
  }
}

function SignatureModal({ savedId, current, onClose, onPick }: { savedId: string | null; current: SigChoice | null; onClose: () => void; onPick: (c: SigChoice) => void }) {
  const [drawing, setDrawing] = useState(!savedId);
  const savedUrl = savedId ? `/api/me/signatures/${savedId}/image` : null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>ลายเซ็น</h2>
          <button className="btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        {!drawing && savedUrl && (
          <>
            <div className="checker">
              <img src={savedUrl} alt="ลายเซ็นที่บันทึกไว้" />
            </div>
            <button className="btn-primary btn-block" onClick={() => onPick({ kind: 'saved', url: savedUrl })}>
              ใช้ลายเซ็นที่บันทึกไว้
            </button>
            <button className="btn-block" onClick={() => setDrawing(true)}>
              เซ็นใหม่เฉพาะครั้งนี้
            </button>
          </>
        )}
        {drawing && (
          <>
            <p className="muted small">ลายเซ็นนี้ใช้กับเอกสารนี้เท่านั้น ไม่เปลี่ยนลายเซ็นที่บันทึกไว้</p>
            <DrawPad onSave={(r) => onPick({ kind: 'once', blob: r.blob, url: URL.createObjectURL(r.blob) })} />
            {savedUrl && (
              <button className="btn-ghost" onClick={() => setDrawing(false)}>
                ← ใช้ลายเซ็นที่บันทึกไว้
              </button>
            )}
          </>
        )}
        {current && <p className="muted small center">ลายเซ็นที่เลือกจะใช้กับทุกช่องลายเซ็นในเอกสารนี้</p>}
      </div>
    </div>
  );
}

function TextModal({ f, value, onClose, onSave }: { f: SignField; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const max = f.settings.maxLength;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(v.trim());
        }}
      >
        <label className="field">
          <span>
            {f.settings.label || 'ข้อความ'} {f.settings.required !== false && <span className="req">*</span>}
          </span>
          <input type="text" autoFocus value={v} maxLength={max} onChange={(e) => setV(e.target.value)} />
          {max && (
            <span className="muted small">
              {v.length}/{max}
            </span>
          )}
        </label>
        <div className="row">
          <button className="btn-primary" type="submit">
            ตกลง
          </button>
          <button type="button" onClick={onClose}>
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  );
}

function DeclineModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/documents/${id}/decline`, { reason });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h2>ปฏิเสธการเซ็น</h2>
        <p className="muted small">เอกสารจะหยุดและกลับไปที่ผู้ส่ง พร้อมเหตุผลของคุณ</p>
        {error && <div className="alert alert-error">{error}</div>}
        <textarea placeholder="เหตุผล (บังคับ)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
        <div className="row">
          <button className="btn-danger" disabled={!reason.trim() || busy} onClick={submit}>
            ยืนยันปฏิเสธ
          </button>
          <button onClick={onClose}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}
