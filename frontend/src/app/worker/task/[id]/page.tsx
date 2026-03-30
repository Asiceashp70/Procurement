'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import api from '@/lib/api';

export default function TaskDetail() {
  const params = useParams();
  const id = params?.id;
  const router = useRouter();
  const [task, setTask] = useState<any>(null);
  const [isReporting, setIsReporting] = useState(false);
  const [issueDesc, setIssueDesc] = useState('');

  useEffect(() => {
    if (id) fetchTask();
  }, [id]);

  const fetchTask = async () => {
    try {
        const res = await api.get(`/tasks/${id}`);
        setTask(res.data);
    } catch(err) {
        alert('Error loading task');
        router.push('/worker');
    }
  };

  const updateStatus = async (status: string) => {
      try {
          await api.patch(`/tasks/${id}/status`, { status });
          fetchTask();
      } catch(err) {
          alert('Error updating status');
      }
  };

  const reportIssue = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          await api.post('/issues', { task_id: id, description: issueDesc });
          alert('Issue reported successfully!');
          setIsReporting(false);
          setIssueDesc('');
      } catch(err) {
          alert('Error reporting issue');
      }
  };

  if (!task) return <div className="flex-center">Loading...</div>;

  return (
    <div className="container" style={{ maxWidth: '600px', padding: '1rem 0' }}>
      <button className="btn btn-outline mb-4" onClick={() => router.push('/worker')}>&larr; Back</button>
      
      <div className="card mb-4">
         <div className="flex-between mb-4">
             <span className="badge badge-info">{task.job_code}</span>
             <span className="badge badge-warning">{task.status}</span>
         </div>
         <h1 className="text-2xl font-bold mb-2">{task.title}</h1>
         <p className="text-muted mb-4">{task.description}</p>
         <div className="text-sm">
             <p><strong>Priority:</strong> {task.priority}</p>
         </div>
      </div>

      <div className="grid-cards" style={{ gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
          {task.status === 'Todo' && (
              <button className="btn btn-primary" onClick={() => updateStatus('Accepted')} style={{ width: '100%', height: '60px', fontSize: '1.2rem' }}>รับงาน (Accept)</button>
          )}
          {(task.status === 'Accepted' || task.status === 'Paused') && (
              <button className="btn btn-success" onClick={() => updateStatus('In Progress')} style={{ width: '100%', height: '60px', fontSize: '1.2rem' }}>เริ่มงาน (Start)</button>
          )}
          {task.status === 'In Progress' && (
              <>
                <button className="btn btn-warning" onClick={() => updateStatus('Paused')} style={{ height: '60px', fontSize: '1.2rem' }}>พักเบรก (Pause)</button>
                <button className="btn btn-primary" onClick={() => updateStatus('Completed')} style={{ height: '60px', fontSize: '1.2rem' }}>เสร็จสิ้น (Complete)</button>
              </>
          )}
      </div>

      {task.status !== 'Completed' && !isReporting && (
          <button className="btn btn-outline" style={{ width: '100%', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setIsReporting(true)}>
             รายงานปัญหา (Report Issue)
          </button>
      )}

      {isReporting && (
          <div className="card mt-4" style={{ borderColor: 'var(--danger)' }}>
             <h3 className="mb-4 text-danger font-bold">Report an Issue</h3>
             <form onSubmit={reportIssue}>
                 <textarea required className="input mb-4" rows={4} placeholder="Describe the problem (e.g., Machine broken, Quality defect)..." value={issueDesc} onChange={e => setIssueDesc(e.target.value)}></textarea>
                 <div className="flex-between">
                     <button type="button" className="btn btn-outline" onClick={() => setIsReporting(false)}>Cancel</button>
                     <button type="submit" className="btn btn-danger">Submit Issue</button>
                 </div>
             </form>
          </div>
      )}
    </div>
  );
}
