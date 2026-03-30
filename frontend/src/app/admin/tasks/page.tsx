'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Plus, Printer } from 'lucide-react';

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', project_id: '', description: '', priority: 'Medium', job_code: '' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
        const [tRes, pRes] = await Promise.all([api.get('/tasks'), api.get('/projects')]);
        setTasks(tRes.data);
        setProjects(pRes.data);
    } catch (err) {}
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...newTask };
    if (!payload.job_code) {
        payload.job_code = `JOB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    }
    await api.post('/tasks', payload);
    setShowModal(false);
    setNewTask({ title: '', project_id: '', description: '', priority: 'Medium', job_code: '' });
    fetchData();
  };

  const statusColors: Record<string, string> = {
    'Todo': 'info', 'In Progress': 'warning', 'Paused': 'danger', 'Completed': 'success'
  };

  return (
    <div>
      <div className="flex-between mb-8">
        <h1 className="font-bold text-3xl">Tasks Pipeline</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={18} /> New Task
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Job Code</th>
              <th>Task Title</th>
              <th>Project</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t: any) => (
              <tr key={t.id}>
                <td className="font-medium text-primary">{t.job_code}</td>
                <td className="font-medium">{t.title}</td>
                <td className="text-muted">{projects.find((p: any) => p.id === t.project_id)?.name || '-'}</td>
                <td>{t.priority}</td>
                <td>
                  <span className={`badge badge-${statusColors[t.status] || 'info'}`}>{t.status}</span>
                </td>
                <td>
                    <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} onClick={() => alert(`Print QR/Barcode for Job Code: ${t.job_code}`)}>
                        <Printer size={14} /> Handle
                    </button>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted">No tasks found. Pipeline is clear.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: '400px' }}>
            <h2 className="mb-4">Create New Task</h2>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="label">Project</label>
                <select required className="input" value={newTask.project_id} onChange={e => setNewTask({...newTask, project_id: e.target.value})}>
                    <option value="">Select Project</option>
                    {projects.map((p:any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="mb-4">
                <label className="label">Task Title</label>
                <input required className="input" type="text" value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} />
              </div>
              <div className="mb-4">
                <label className="label">Description</label>
                <textarea className="input" value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})} rows={2}></textarea>
              </div>
              <div className="mb-8">
                <label className="label">Priority</label>
                <select className="input" value={newTask.priority} onChange={e => setNewTask({...newTask, priority: e.target.value})}>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                </select>
              </div>
              <div className="flex-between">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
