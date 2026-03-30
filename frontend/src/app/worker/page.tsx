'use client';

import Link from 'next/link';
import { QrCode, ClipboardList } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '@/lib/api';

export default function WorkerHome() {
  const [myTasks, setMyTasks] = useState([]);

  useEffect(() => {
    fetchMyTasks();
  }, []);

  const fetchMyTasks = async () => {
     try {
         const res = await api.get('/tasks');
         const active = res.data.filter((t:any) => t.status === 'Accepted' || t.status === 'In Progress');
         setMyTasks(active);
     } catch(err) {}
  };

  return (
    <div className="container" style={{ maxWidth: '600px', padding: '1rem 0' }}>
      <Link href="/worker/scan" style={{ display: 'block' }}>
        <div className="card text-center mb-8" style={{ cursor: 'pointer', transition: 'transform 0.2s', border: '2px dashed var(--primary)' }}>
          <QrCode size={64} style={{ color: 'var(--primary)', margin: '0 auto', marginBottom: '1rem' }} />
          <h2 className="font-bold text-2xl">Scan Job Code</h2>
          <p className="text-muted mt-2">Tap to open Camera Scanner and accept work</p>
        </div>
      </Link>

      <h3 className="mb-4 flex-center font-bold" style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
        <ClipboardList size={20} /> My Active Tasks
      </h3>
      
      {myTasks.length === 0 ? (
        <div className="card text-center text-muted">No active tasks right now.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {myTasks.map((t:any) => (
            <Link key={t.id} href={`/worker/task/${t.id}`} style={{ display: 'block' }}>
              <div className="card" style={{ transition: 'transform 0.2s', cursor: 'pointer' }}>
                <div className="flex-between mb-2">
                  <span className="font-bold text-primary">{t.job_code}</span>
                  <span className="badge badge-warning">{t.status}</span>
                </div>
                <p className="font-medium text-lg">{t.title}</p>
                <p className="text-muted mt-2 text-sm">Tap to view details and update status</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
