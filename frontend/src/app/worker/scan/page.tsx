'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Html5QrcodeScanner } from 'html5-qrcode';
import api from '@/lib/api';
import { Search } from 'lucide-react';

export default function ScanPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [loading, setLoading] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  const navigateToTask = async (jobCode: string) => {
    if (!jobCode.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/tasks/job_code/${jobCode.trim()}`);
      router.push(`/worker/task/${res.data.id}`);
    } catch {
      setError(`ไม่พบ Job Code: "${jobCode.trim()}" ในระบบ`);
      setLoading(false);
    }
  };

  useEffect(() => {
    const scanner = new Html5QrcodeScanner('reader', { fps: 10, qrbox: { width: 250, height: 250 } }, false);
    scannerRef.current = scanner;

    scanner.render(async (decodedText) => {
      scanner.clear();
      await navigateToTask(decodedText);
    }, () => {});

    return () => {
      scanner.clear().catch(() => {});
    };
  }, []);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await navigateToTask(manualCode);
  };

  return (
    <div className="container" style={{ maxWidth: '500px', paddingTop: '1rem' }}>
      <h2 className="mb-4 text-center font-bold text-2xl">Scan Job Code</h2>

      {error && (
        <div className="badge badge-danger mb-4" style={{ display: 'block', textAlign: 'center', padding: '0.5rem' }}>
          {error}
        </div>
      )}

      {/* Manual Input */}
      <div className="card mb-4">
        <p className="label mb-2">พิมพ์ Job Code ด้วยตนเอง</p>
        <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            className="input"
            placeholder="เช่น JOB-ABC123"
            value={manualCode}
            onChange={e => setManualCode(e.target.value.toUpperCase())}
            disabled={loading}
            style={{ flex: 1, fontFamily: 'monospace', fontWeight: 600, fontSize: '1rem', letterSpacing: '0.05em' }}
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !manualCode.trim()}>
            {loading ? '...' : <Search size={18} />}
          </button>
        </form>
      </div>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border)' }} />
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>หรือ สแกน QR Code</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border)' }} />
      </div>

      {/* QR Scanner */}
      <div className="card" style={{ padding: '1rem', background: '#fff' }}>
        <div id="reader" style={{ width: '100%' }}></div>
      </div>

      <div className="mt-8 text-center">
        <button className="btn btn-outline" onClick={() => router.push('/worker')}>ยกเลิก</button>
      </div>
    </div>
  );
}
