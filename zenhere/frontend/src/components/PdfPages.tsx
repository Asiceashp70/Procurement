import { useEffect, useRef, useState, type ReactNode } from 'react';
import { displaySize, loadPdf, type PageInfo, type PDFDocumentProxy } from '../lib/pdf';

export interface PdfPagesProps {
  url: string;
  pages: PageInfo[];
  /** 1 = fit the container width */
  zoom?: number;
  /** drawn on top of each page; size is the displayed page box in CSS px */
  overlay?: (page: PageInfo, size: { width: number; height: number }) => ReactNode;
  onReady?: () => void;
  gap?: number;
}

/**
 * DOC-03: shows every page, but only renders those near the viewport, so a
 * 50-page document opens quickly on a phone. Page boxes are sized from the
 * server's page list before rendering, so overlays and scroll targets are stable.
 */
export function PdfPages({ url, pages, zoom = 1, overlay, onReady, gap = 12 }: PdfPagesProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    loadPdf(url).then(
      (d) => {
        loaded = d;
        if (cancelled) d.destroy();
        else {
          setDoc(d);
          onReady?.();
        }
      },
      () => !cancelled && setError('เปิดไฟล์ไม่ได้'),
    );
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.max(200, Math.round(width * zoom));
  return (
    <div ref={wrapRef} style={{ width: '100%', overflowX: zoom > 1 ? 'auto' : 'visible' }}>
      {error && <div className="alert alert-error">{error}</div>}
      {width > 0 &&
        pages.map((p) => {
          const d = displaySize(p);
          const size = { width: pageWidth, height: Math.round((pageWidth * d.height) / d.width) };
          return (
            <div key={p.pageNo} data-page={p.pageNo} className="pdf-page" style={{ width: size.width, height: size.height, marginBottom: gap }}>
              <PageCanvas doc={doc} pageNo={p.pageNo} cssWidth={size.width} />
              <div className="pdf-overlay">{overlay?.(p, size)}</div>
              <span className="pdf-page-no">{p.pageNo}</span>
            </div>
          );
        })}
    </div>
  );
}

function PageCanvas({ doc, pageNo, cssWidth }: { doc: PDFDocumentProxy | null; pageNo: number; cssWidth: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !visible || !ref.current) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    const timer = setTimeout(async () => {
      const page = await doc.getPage(pageNo);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = ref.current!;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
      task.promise.catch(() => undefined);
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, visible, pageNo, cssWidth]);

  return <canvas ref={ref} className="pdf-canvas" />;
}
