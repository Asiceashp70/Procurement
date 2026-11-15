import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PdfPages } from '../components/PdfPages';
import { api, errorText } from '../lib/api';
import type { DocDetail } from '../lib/documents';

interface Highlights {
  pageNo: number;
  source: 'pdf' | 'ocr' | null;
  confidence: number | null;
  boxes: { x: number; y: number; w: number; h: number }[];
}

/** SRC-04: opens the document at the page of a search hit with the words highlighted. */
export function DocumentViewPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const target = Number(params.get('page') ?? 1);
  const q = params.get('q') ?? '';
  const pagesWithHits = (params.get('pages') ?? String(target)).split(',').map(Number).filter(Boolean);
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [hl, setHl] = useState<Record<number, Highlights>>({});
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<DocDetail>(`/documents/${id}`).then(setDoc, (e) => setError(errorText(e)));
  }, [id]);
  useEffect(() => {
    if (!q) return;
    for (const p of new Set([target, ...pagesWithHits])) {
      api.get<Highlights>(`/documents/${id}/pages/${p}/highlights?q=${encodeURIComponent(q)}`).then((h) => setHl((cur) => ({ ...cur, [p]: h })), () => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, q, target]);

  const scrollToTarget = () =>
    setTimeout(() => {
      const el = scroller.current?.querySelector(`[data-page="${target}"]`) as HTMLElement | null;
      const box = hl[target]?.boxes[0];
      if (!el) return;
      const y = el.getBoundingClientRect().top + window.scrollY + (box ? box.y * el.offsetHeight : 0) - 160;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }, 150);
  useEffect(() => {
    if (doc) scrollToTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, hl[target]]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!doc) return <div className="loading">กำลังโหลด...</div>;
  const t = hl[target];
  return (
    <div>
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="row between">
          <h1 style={{ margin: 0 }}>{doc.title}</h1>
          <Link to={`/documents/${id}`} className="small">
            รายละเอียดเอกสาร →
          </Link>
        </div>
        <div className="muted small">
          หน้า {target} · คำค้น "<mark>{q}</mark>"{t && ` · พบ ${t.boxes.length} ตำแหน่งในหน้านี้`}
        </div>
        {t?.source === 'ocr' && (
          <div className="alert alert-warn small" style={{ margin: '8px 0 0' }}>
            หน้านี้อ่านด้วย OCR{t.confidence !== null ? ` (มั่นใจ ${Math.round(t.confidence * 100)}%)` : ''} ข้อความและตำแหน่งที่ไฮไลต์อาจคลาดเคลื่อน
          </div>
        )}
      </div>
      <div className="pdf-scroller" ref={scroller}>
        <PdfPages
          url={`/api/documents/${id}/file?v=${doc.finalReady ? 'final' : 'source'}`}
          pages={doc.pages}
          overlay={(page) =>
            hl[page.pageNo]?.boxes.map((b, i) => (
              <div
                key={i}
                className="hl-box"
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
              />
            ))
          }
        />
      </div>
    </div>
  );
}
