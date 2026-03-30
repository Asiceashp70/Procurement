'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Package, CheckCircle, Clock } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState({ totalProjects: 0, activeTasks: 0, completedTasks: 0 });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const projectsRes = await api.get('/projects');
      const tasksRes = await api.get('/tasks');
      
      const projects = projectsRes.data;
      const tasks = tasksRes.data;

      setStats({
        totalProjects: projects.length,
        activeTasks: tasks.filter((t: any) => t.status === 'In Progress' || t.status === 'Todo').length,
        completedTasks: tasks.filter((t: any) => t.status === 'Completed').length,
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <h1 className="mb-8 font-bold text-3xl">Dashboard Overview</h1>
      
      <div className="grid-cards">
        <div className="card flex-between">
          <div>
            <p className="text-muted mb-2">Total Projects</p>
            <h2 className="text-3xl font-bold">{stats.totalProjects}</h2>
          </div>
          <div style={{ padding: '1rem', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '50%', color: '#3B82F6' }}>
            <Package size={32} />
          </div>
        </div>

        <div className="card flex-between">
          <div>
            <p className="text-muted mb-2">Active Tasks</p>
            <h2 className="text-3xl font-bold">{stats.activeTasks}</h2>
          </div>
          <div style={{ padding: '1rem', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: '50%', color: '#F59E0B' }}>
            <Clock size={32} />
          </div>
        </div>

        <div className="card flex-between">
          <div>
            <p className="text-muted mb-2">Completed Tasks</p>
            <h2 className="text-3xl font-bold">{stats.completedTasks}</h2>
          </div>
          <div style={{ padding: '1rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '50%', color: '#10B981' }}>
            <CheckCircle size={32} />
          </div>
        </div>
      </div>
    </div>
  );
}
