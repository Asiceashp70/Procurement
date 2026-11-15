import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorText } from '../lib/api';
import { candidateName, DOC_BADGE, DOC_STATUS, EVENT_LABEL, SIGNER_STATUS, type Candidate, type DocDetail, type DocSigner } from '../lib/documents';
import { thaiDateTime } from '../lib/thai';

/** DOC-09: who has opened, signed, or not added the OA yet; remind, void, replace, download. */
export function DocumentDetailPage() {
  const { id } = useParams();
  const [d, setD] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<DocSigner | null>(null);

  const load = useCallback(() => api.get<DocDetail>(`/documents/${id}`).then(setD, (e) => setError(errorText(e))), [id]);
  useEffect(() => {
    load();
  }, [load]);
  // the final PDF is built in the background right after the last signature
  useEffect(() => {
    if (d?.status !== 'completed' || d.finalReady) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [d, load]);

  if (error && !d) return <div className="alert alert-error">{error}</div>;
  if (!d) return <div className="loading">กำลังโหลด...</div>;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const remind = (s?: DocSigner) =>
    run(async () => {
      const r = await api.post<{ sent: string[]; skipped: { nextAt: string }[] }>(`/documents/${id}/remind`, s ? { signerIds: [s.id] } : {});
      if (!r.sent.length && r.skipped.length) throw new Error(`เพิ่งเตือนไปแล้ว เตือนได้อีกครั้งหลัง ${thaiDateTime(r.skipped[0].nextAt)}`);
    }, 'ส่งเตือนทาง LINE แล้ว');
  const voidDoc = () => {
    const reason = window.prompt('เหตุผลที่ยกเลิกเอกสาร');
    if (reason?.trim()) run(() => api.post(`/documents/${id}/void`, { reason }), 'ยกเลิกเอกสารแล้ว');
  };

  const active = d.signers.filter((s) => s.status !== 'replaced');
  const replaced = d.signers.filter((s) => s.status === 'replaced');
  return (
    <div className="stack">
      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <h1 style={{ marginBottom: 4 }}>{d.title}</h1>
          <span className={`badge ${DOC_BADGE[d.status]}`}>{DOC_STATUS[d.status]}</span>
        </div>
        {d.overdue && <span className="badge badge-rejected">เลยกำหนด</span>}
        <div className="muted small">
          {d.companyName} · ส่งโดย {d.creatorName} · {d.pageCount} หน้า
          <br />
          {d.sentAt && `ส่งเมื่อ ${thaiDateTime(d.sentAt)} · `}
          {d.dueAt && `กำหนด ${thaiDateTime(d.dueAt)} · `}
          {d.signingMode === 'sequential' ? 'เซ็นตามลำดับ' : 'เซ็นพร้อมกัน'}
        </div>
        {d.description && <p className="small" style={{ marginTop: 8 }}>{d.description}</p>}
        {d.voidReason && <div className="alert alert-warn small">ยกเลิกเพราะ: {d.voidReason}</div>}
        {msg && <div className="alert alert-ok small">{msg}</div>}
        {error && <div className="alert alert-error small">{error}</div>}
        <div className="row" style={{ marginTop: 8 }}>
          {d.me.canSign && (
            <Link className="btn btn-primary" to={`/documents/${id}/sign`}>
              เปิดเพื่อเซ็น
            </Link>
          )}
          {d.me.canEdit && (
            <Link className="btn btn-primary" to={`/documents/${id}/edit`}>
              แก้ไขร่าง
            </Link>
          )}
          {d.finalReady && (
            <a className="btn btn-primary" href={`/api/documents/${id}/file?v=final&download=1`}>
              ⬇ ไฟล์ฉบับสมบูรณ์
            </a>
          )}
          {d.status === 'completed' && !d.finalReady && <span className="muted small">กำลังสร้างไฟล์ฉบับสมบูรณ์...</span>}
          <a className="btn" href={`/api/documents/${id}/file?v=source`} target="_blank" rel="noreferrer">
            ดูต้นฉบับ
          </a>
          {d.me.canRemind && <button onClick={() => remind()}>เตือนซ้ำทุกคนที่ถึงลำดับ</button>}
          {d.me.canVoid && (
            <button className="btn-danger" onClick={voidDoc}>
              ยกเลิกเอกสาร
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h2>ผู้เซ็น</h2>
        {active.map((s) => (
          <div key={s.id} className="list-item">
            <div className="row between" style={{ flexWrap: 'nowrap' }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <span className="badge badge-admin">{s.order}</span>
                <div>
                  <strong>{s.displayName ?? candidateName(s)}</strong>
                  <div className="muted small">{[s.positionName, s.departmentName].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
              <span className={`badge ${s.status === 'signed' ? 'badge-approved' : s.status === 'declined' ? 'badge-rejected' : 'badge-pending'}`}>{SIGNER_STATUS[s.status]}</span>
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>
              {s.signedAt ? `เซ็นเมื่อ ${thaiDateTime(s.signedAt)}` : s.openedAt ? `เปิดดูแล้ว ${thaiDateTime(s.openedAt)}` : s.notifiedAt ? 'ยังไม่เปิดดู' : ''}
              {s.reminderCount > 0 && ` · เตือนแล้ว ${s.reminderCount} ครั้ง`}
              {!s.isOaFriend && s.status !== 'signed' && <span style={{ color: 'var(--red)' }}> · ส่ง LINE ไม่ได้ (ยังไม่แอด OA) ต้องตามเอง</span>}
            </div>
            {s.declineReason && <div className="small">เหตุผลที่ปฏิเสธ: {s.declineReason}</div>}
            {d.status === 'pending' && (s.status === 'pending' || s.status === 'waiting') && (
              <div className="row" style={{ marginTop: 6 }}>
                {d.me.canRemind && s.status === 'pending' && (
                  <button className="btn-sm" onClick={() => remind(s)}>
                    เตือน
                  </button>
                )}
                {d.me.canReplaceSigner && (
                  <button className="btn-sm" onClick={() => setReplacing(s)}>
                    เปลี่ยนผู้เซ็น
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {replaced.map((s) => (
          <div key={s.id} className="list-item muted small">
            <s>{s.displayName}</s> ถูกเปลี่ยนตัว · {s.replacedReason}
          </div>
        ))}
      </div>

      {(d.status === 'completed' || d.originalSha256) && (
        <div className="card small">
          <h2>การตรวจสอบไฟล์</h2>
          <div>SHA-256 ต้นฉบับ</div>
          <div className="hash muted">{d.originalSha256}</div>
          {d.finalSha256 && (
            <>
              <div style={{ marginTop: 8 }}>SHA-256 ฉบับสมบูรณ์</div>
              <div className="hash muted">{d.finalSha256}</div>
              <div style={{ marginTop: 8 }}>
                {d.sealStatus === 'sealed' ? `✓ ซีลด้วยใบรับรองดิจิทัลของบริษัท${d.timestamped ? ' พร้อมเวลาจาก TSA' : ''}` : '⚠️ ไม่ได้ซีลด้วยใบรับรองดิจิทัล (บริษัทยังไม่มีใบรับรองหรือหมดอายุ)'}
              </div>
            </>
          )}
          <Link to="/verify">ตรวจสอบไฟล์ที่มีอยู่ →</Link>
        </div>
      )}

      <div className="card">
        <h2>ประวัติ</h2>
        <ul className="timeline">
          {d.events.map((e) => (
            <li key={e.id}>
              <strong>{EVENT_LABEL[e.type] ?? e.type}</strong> · {e.actorName}
              <div className="muted small">
                {thaiDateTime(e.createdAt)}
                {e.ip && ` · IP ${e.ip}`}
                {typeof e.details?.reason === 'string' && ` · ${e.details.reason}`}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {replacing && (
        <ReplaceSigner
          doc={d}
          signer={replacing}
          onClose={() => setReplacing(null)}
          onDone={() => {
            setReplacing(null);
            setMsg('เปลี่ยนผู้เซ็นแล้ว ระบบแจ้งทุกคนที่เกี่ยวข้องทาง LINE');
            load();
          }}
        />
      )}
    </div>
  );
}

/** DOC-10 */
function ReplaceSigner({ doc, signer, onClose, onDone }: { doc: DocDetail; signer: DocSigner; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Candidate[]>([]);
  const [pick, setPick] = useState<Candidate | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => api.get<Candidate[]>(`/companies/${doc.companyId}/signer-candidates?q=${encodeURIComponent(q)}`).then(setHits), 200);
    return () => clearTimeout(t);
  }, [q, doc.companyId]);
  const taken = new Set(doc.signers.filter((s) => s.status !== 'replaced').map((s) => s.userId));
  const submit = async () => {
    try {
      await api.post(`/documents/${doc.id}/signers/${signer.id}/replace`, { userId: pick!.userId, reason });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h2>เปลี่ยนผู้เซ็นแทน {signer.displayName}</h2>
        <p className="muted small">กรอบทั้งหมดของคนเดิมจะย้ายไปที่คนใหม่โดยใช้ลำดับเดิม การเปลี่ยนถูกบันทึกและแสดงในหน้าใบรับรอง</p>
        {error && <div className="alert alert-error">{error}</div>}
        <input type="search" placeholder="ค้นหาพนักงาน" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {hits
            .filter((c) => !taken.has(c.userId))
            .map((c) => (
              <label key={c.userId} className="list-item row small" style={{ flexWrap: 'nowrap' }}>
                <input type="radio" name="pick" checked={pick?.userId === c.userId} onChange={() => setPick(c)} />
                <span>
                  {candidateName(c)} <span className="muted">{[c.departmentName, c.positionName].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            ))}
        </div>
        <textarea placeholder="เหตุผล (บังคับ)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <div className="row">
          <button className="btn-primary" disabled={!pick || !reason.trim()} onClick={submit}>
            เปลี่ยนผู้เซ็น
          </button>
          <button onClick={onClose}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}
