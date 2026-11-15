import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';
import { analyze, INK, render, trimTransparent, type Analysis, type InkColor, type RenderOptions } from '../lib/cutout';
import { loadImageFile, rgbaToCanvas, toPngBlob } from '../lib/canvas';

export interface SignatureResult {
  blob: Blob;
  method: 'draw' | 'upload';
}

const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const MAX_UPLOAD = 10 * 1024 * 1024;

export function SignatureEditor({ onSave, saving }: { onSave: (r: SignatureResult) => void; saving?: boolean }) {
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  return (
    <div>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button type="button" className={mode === 'draw' ? 'active' : ''} onClick={() => setMode('draw')}>
          ✍️ วาดลายเซ็น
        </button>
        <button type="button" className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}>
          📷 ใช้รูปถ่าย
        </button>
      </div>
      {mode === 'draw' ? <DrawPad onSave={onSave} saving={saving} /> : <UploadCutout onSave={onSave} saving={saving} />}
    </div>
  );
}

// --------------------------------------------------------------------------- draw (SIG-01)

function DrawPad({ onSave, saving }: { onSave: (r: SignatureResult) => void; saving?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [color, setColor] = useState<'black' | 'blue'>('black');
  const [empty, setEmpty] = useState(true);
  const [full, setFull] = useState(false);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    const pad = padRef.current;
    if (!canvas || !pad) return;
    const data = pad.toData();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d')!.scale(ratio, ratio);
    pad.clear();
    pad.fromData(data);
  }, []);

  useEffect(() => {
    const pad = new SignaturePad(canvasRef.current!, {
      minWidth: 0.9,
      maxWidth: 3.2,
      velocityFilterWeight: 0.7, // stroke gets thinner when drawn fast
      penColor: rgb(INK.black),
      backgroundColor: 'rgba(0,0,0,0)',
    });
    padRef.current = pad;
    const onEnd = () => setEmpty(pad.isEmpty());
    pad.addEventListener('endStroke', onEnd);
    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      pad.removeEventListener('endStroke', onEnd);
      pad.off();
    };
  }, [fit]);

  useLayoutEffect(() => fit(), [full, fit]);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    pad.penColor = rgb(INK[color]);
    pad.fromData(pad.toData().map((g) => ({ ...g, penColor: rgb(INK[color]) })));
  }, [color]);

  const undo = () => {
    const pad = padRef.current!;
    const data = pad.toData();
    data.pop();
    pad.fromData(data);
    setEmpty(pad.isEmpty());
  };
  const clear = () => {
    padRef.current!.clear();
    setEmpty(true);
  };
  const save = async () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const trimmed = trimTransparent({ ...ctx.getImageData(0, 0, canvas.width, canvas.height), width: canvas.width, height: canvas.height });
    if (!trimmed) return;
    setFull(false);
    onSave({ blob: await toPngBlob(trimmed), method: 'draw' });
  };

  const controls = (
    <div className="row between">
      <div className="row">
        <div className="seg">
          <button type="button" className={color === 'black' ? 'active' : ''} onClick={() => setColor('black')}>
            ดำ
          </button>
          <button type="button" className={color === 'blue' ? 'active' : ''} onClick={() => setColor('blue')}>
            น้ำเงิน
          </button>
        </div>
        <button type="button" className="btn-sm" onClick={undo} disabled={empty}>
          ↶ ย้อนกลับ
        </button>
        <button type="button" className="btn-sm" onClick={clear} disabled={empty}>
          ล้าง
        </button>
      </div>
      <button type="button" className="btn-sm btn-ghost" onClick={() => setFull((f) => !f)}>
        {full ? 'ย่อ' : '⛶ เต็มจอ'}
      </button>
    </div>
  );

  return (
    <div className={full ? 'sig-fullscreen' : 'stack'}>
      {full && <p className="muted center small">หมุนโทรศัพท์เป็นแนวนอนเพื่อให้มีที่เซ็นมากขึ้น</p>}
      <div ref={wrapRef} className="sig-canvas-wrap" style={full ? undefined : { height: 220 }}>
        <span className="hint">เซ็นชื่อในกรอบนี้ด้วยนิ้วหรือปากกา</span>
        <div className="baseline" />
        <canvas ref={canvasRef} />
      </div>
      {controls}
      <button type="button" className="btn-primary btn-block" onClick={save} disabled={empty || saving}>
        {saving ? 'กำลังบันทึก...' : 'ใช้ลายเซ็นนี้'}
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------- upload + cutout (SIG-02..04)

function UploadCutout({ onSave, saving }: { onSave: (r: SignatureResult) => void; saving?: boolean }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<RenderOptions>({ sensitivity: 50, color: 'original', rotate: 0, trim: { top: 0, right: 0, bottom: 0, left: 0 } });
  const [ink, setInk] = useState(0);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<ReturnType<typeof render> | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!['image/jpeg', 'image/png'].includes(file.type)) return setError('รองรับเฉพาะไฟล์ JPG หรือ PNG');
    if (file.size > MAX_UPLOAD) return setError('ไฟล์ใหญ่เกิน 10 MB');
    setBusy(true);
    try {
      const img = await loadImageFile(file, 1600);
      // let the "processing" state paint before the heavy work
      await new Promise((r) => setTimeout(r, 30));
      setAnalysis(analyze(img));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เปิดรูปไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!analysis) return;
    const id = requestAnimationFrame(() => {
      const out = render(analysis, opts);
      resultRef.current = out;
      setInk(out.inkPixels);
      if (previewRef.current) rgbaToCanvas(out, previewRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [analysis, opts]);

  const setTrim = (k: 'top' | 'right' | 'bottom' | 'left', v: number) => setOpts((o) => ({ ...o, trim: { ...o.trim!, [k]: v } }));
  const save = async () => {
    if (!resultRef.current || !ink) return;
    onSave({ blob: await toPngBlob(resultRef.current), method: 'upload' });
  };

  return (
    <div className="stack">
      <p className="muted small">เซ็นบนกระดาษขาวด้วยปากกาสีเข้ม ถ่ายให้เห็นลายเซ็นชัด ระบบจะไดคัทพื้นหลังออกให้เอง</p>
      <div className="row">
        <label className="btn">
          📁 เลือกรูป
          <input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <label className="btn">
          📷 ถ่ายรูป
          <input type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {busy && <div className="loading">กำลังประมวลผลรูป...</div>}
      {analysis && !busy && (
        <>
          <div className="checker">
            <canvas ref={previewRef} />
          </div>
          {ink === 0 && <div className="alert alert-warn">ไม่พบลายเซ็นในรูป ลองเพิ่มความไว หรือถ่ายใหม่ให้ชัดขึ้น</div>}
          <label className="field">
            <span>ความไว ({opts.sensitivity})</span>
            <input type="range" min={0} max={100} value={opts.sensitivity} onChange={(e) => setOpts({ ...opts, sensitivity: Number(e.target.value) })} />
            <span className="muted small">เพิ่มถ้าเส้นขาดหาย ลดถ้ามีจุดสกปรกติดมา</span>
          </label>
          <div className="row">
            <span>สีหมึก</span>
            <div className="seg">
              {(['original', 'black', 'blue'] as InkColor[]).map((c) => (
                <button key={c} type="button" className={opts.color === c ? 'active' : ''} onClick={() => setOpts({ ...opts, color: c })}>
                  {c === 'original' ? 'ตามจริง' : c === 'black' ? 'ดำ' : 'น้ำเงิน'}
                </button>
              ))}
            </div>
            <button type="button" className="btn-sm" onClick={() => setOpts({ ...opts, rotate: (((opts.rotate + 90) % 360) as RenderOptions['rotate']) })}>
              ↻ หมุน
            </button>
          </div>
          <details>
            <summary>ครอปเพิ่ม</summary>
            <div className="grid2" style={{ marginTop: 8 }}>
              {(
                [
                  ['top', 'ตัดด้านบน'],
                  ['bottom', 'ตัดด้านล่าง'],
                  ['left', 'ตัดด้านซ้าย'],
                  ['right', 'ตัดด้านขวา'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="field">
                  <span className="small">{label}</span>
                  <input type="range" min={0} max={45} value={Math.round(opts.trim![k] * 100)} onChange={(e) => setTrim(k, Number(e.target.value) / 100)} />
                </label>
              ))}
            </div>
          </details>
          <button type="button" className="btn-primary btn-block" onClick={save} disabled={!ink || saving}>
            {saving ? 'กำลังบันทึก...' : 'ใช้ลายเซ็นนี้'}
          </button>
        </>
      )}
    </div>
  );
}
