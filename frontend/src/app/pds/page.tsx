'use client';

import { useEffect, useState } from 'react';
import { socket } from '@/lib/socket';
import api from '@/lib/api';
import { RefreshCw, AlertTriangle, Flame } from 'lucide-react';

const STATUS_COLUMNS = [
  { key: 'Todo',        label: 'PENDING',     color: '#F59E0B', count_color: '#F59E0B' },
  { key: 'In Progress', label: 'IN PROGRESS',  color: '#3B82F6', count_color: '#3B82F6' },
  { key: 'Accepted',    label: 'SUBMITTED',    color: '#A78BFA', count_color: '#A78BFA' },
  { key: 'Completed',   label: 'COMPLETED',    color: '#10B981', count_color: '#10B981' },
];

const PRIORITY_ICON: Record<string, any> = {
  Critical: <Flame size={16} style={{ color: '#EF4444' }} />,
  High:     <AlertTriangle size={16} style={{ color: '#F59E0B' }} />,
};

export default function PDSDashboard() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    fetchData();
    socket.connect();
    socket.on('task_created', () => fetchData());
    socket.on('task_status_changed', () => fetchData());
    return () => { socket.off('task_created'); socket.off('task_status_changed'); socket.disconnect(); };
  }, []);

  const fetchData = async () => {
    try {
      const [tRes, pRes] = await Promise.all([api.get('/tasks'), api.get('/projects')]);
      setTasks(tRes.data);
      setProjects(pRes.data);
      setLastUpdated(new Date());
    } catch {}
  };

  const getProject = (id: string) => projects.find((p: any) => p.id === id);

  const dateStr = (dt: string) =>
    new Date(dt).toLocaleDateString('th-TH', { day: '2-digit', month:'2-digit', year:'numeric' })
    + ' ' + new Date(dt).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });

  return (
    <div style={{ background: '#0D1117', minHeight: '100vh', padding: '1rem', fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ color: '#fff', fontWeight: 700, fontSize: '1.5rem', margin: 0 }}>Production Monitor</h1>
          <p style={{ color: '#6B7280', fontSize: '0.75rem', margin: 0 }}>
            อัปเดตล่าสุด: {lastUpdated.toLocaleDateString('th-TH')} {lastUpdated.toLocaleTimeString('th-TH')}
          </p>
        </div>
        <button onClick={fetchData} style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'transparent', border:'1px solid #4F46E5', color:'#818CF8', padding:'0.5rem 1rem', borderRadius:'0.375rem', cursor:'pointer', fontWeight:500 }}>
          <RefreshCw size={15} /> รีเฟรช
        </button>
      </div>

      {/* Kanban Board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', alignItems: 'start' }}>
        {STATUS_COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.key);
          return (
            <div key={col.key} style={{ background: '#161B22', borderRadius: '0.75rem', overflow: 'hidden', border: `1px solid #30363D` }}>
              {/* Column Header */}
              <div style={{ padding: '0.75rem 1rem', borderBottom: `2px solid ${col.color}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: col.color, fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.05em' }}>{col.label}</span>
                <span style={{ background: col.color, color: '#fff', borderRadius: '9999px', fontWeight: 700, fontSize: '0.75rem', padding: '0.1rem 0.5rem' }}>{colTasks.length}</span>
              </div>

              {/* Cards */}
              <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
                {colTasks.map(t => {
                  const proj = getProject(t.project_id);
                  const isOverdue = col.key !== 'Completed' && t.priority === 'Critical';
                  return (
                    <div key={t.id} style={{ background: isOverdue ? '#1A0A0A' : '#0D1117', border: `1px solid ${isOverdue ? '#7F1D1D' : '#30363D'}`, borderRadius: '0.5rem', padding: '0.75rem', position: 'relative' }}>
                      {/* Top: Job Code + Date */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ color: col.color, fontWeight: 600, fontSize: '0.75rem' }}>#{t.job_code}</span>
                        <span style={{ color: '#6B7280', fontSize: '0.7rem' }}>{dateStr(t.created_at)}</span>
                      </div>
                      
                      {/* Assignee Row */}
                      <div style={{ fontSize: '0.7rem', color: '#9CA3AF', marginBottom: '0.5rem' }}>
                        ผู้สั่ง: <span style={{ color: '#E5E7EB' }}>—</span>
                      </div>

                      {/* Title */}
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: '#F9FAFB', marginBottom: '0.5rem', lineHeight: 1.3 }}>{t.title}</div>

                      {/* Meta */}
                      <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '0.5rem' }}>
                        Qty: — | MC: {proj?.name?.substring(0,6) || 'N/A'}
                      </div>

                      {/* Priority Tag */}
                      {t.priority === 'Critical' && (
                        <span style={{ display: 'inline-block', background: '#7F1D1D', color: '#FCA5A5', borderRadius: '0.25rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', marginBottom: '0.4rem' }}>ด่วน</span>
                      )}

                      {/* Station Flow */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: col.color }}>
                        <span>{proj?.name?.substring(0,5) || 'STA01'}</span>
                        <span>→</span>
                        <span style={{ color: '#6B7280' }}>—</span>
                        {PRIORITY_ICON[t.priority] && <span style={{ marginLeft: 'auto' }}>{PRIORITY_ICON[t.priority]}</span>}
                      </div>
                    </div>
                  );
                })}
                {colTasks.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '2rem 0', color: '#374151', fontSize: '0.85rem' }}>ไม่มีงาน</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
