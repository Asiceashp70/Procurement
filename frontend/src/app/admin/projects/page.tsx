'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Plus } from 'lucide-react';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '', expect_end_date: '' });

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
        const res = await api.get('/projects');
        setProjects(res.data);
    } catch (err) { }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/projects', newProject);
    setShowModal(false);
    setNewProject({ name: '', description: '', expect_end_date: '' });
    fetchProjects();
  };

  return (
    <div>
      <div className="flex-between mb-8">
        <h1 className="font-bold text-3xl">Projects</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={18} /> New Project
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Status</th>
              <th>Deadline</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p: any) => (
              <tr key={p.id}>
                <td className="font-medium text-main">{p.name}</td>
                <td className="text-muted">{p.description}</td>
                <td>
                  <span className={`badge badge-${p.status === 'Completed' ? 'success' : 'info'}`}>
                    {p.status}
                  </span>
                </td>
                <td>{p.expect_end_date ? new Date(p.expect_end_date).toLocaleDateString() : '-'}</td>
                <td className="text-muted">{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr><td colSpan={5} className="text-center text-muted">No projects found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: '400px' }}>
            <h2 className="mb-4">Create New Project</h2>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="label">Project Name</label>
                <input required className="input" type="text" value={newProject.name} onChange={e => setNewProject({...newProject, name: e.target.value})} />
              </div>
              <div className="mb-4">
                <label className="label">Description</label>
                <textarea className="input" value={newProject.description} onChange={e => setNewProject({...newProject, description: e.target.value})} rows={3}></textarea>
              </div>
              <div className="mb-8">
                <label className="label">Deadline</label>
                <input className="input" type="date" value={newProject.expect_end_date} onChange={e => setNewProject({...newProject, expect_end_date: e.target.value})} />
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
