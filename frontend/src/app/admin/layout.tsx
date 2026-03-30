'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, FolderKanban, ListTodo, MonitorPlay, LogOut } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    if (!token || !userData) {
      router.push('/login');
      return;
    }
    const parsed = JSON.parse(userData);
    if (parsed.role === 'Employee') {
      router.push('/worker');
      return;
    }
    setUser(parsed);
  }, [router]);

  const handleLogout = () => {
    localStorage.clear();
    router.push('/login');
  };

  if (!user) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{ width: '250px', backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        <div className="mb-8">
          <h2 style={{ color: 'var(--primary)', margin: 0 }}>PMS Admin</h2>
          <div className="badge badge-info mt-4" style={{ fontSize: '0.7rem' }}>{user.full_name} ({user.role})</div>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Link href="/admin"><div className="btn btn-outline" style={{width: '100%', justifyContent: 'flex-start', border: 'none'}}><LayoutDashboard size={18} /> Dashboard</div></Link>
          <Link href="/admin/projects"><div className="btn btn-outline" style={{width: '100%', justifyContent: 'flex-start', border: 'none'}}><FolderKanban size={18} /> Projects</div></Link>
          <Link href="/admin/tasks"><div className="btn btn-outline" style={{width: '100%', justifyContent: 'flex-start', border: 'none'}}><ListTodo size={18} /> Tasks</div></Link>
          <div style={{ height: '1px', backgroundColor: 'var(--border)', margin: '1rem 0' }}></div>
          <Link href="/pds" target="_blank"><div className="btn btn-outline" style={{width: '100%', justifyContent: 'flex-start', border: 'none'}}><MonitorPlay size={18} /> Live PDS</div></Link>
        </nav>

        <button onClick={handleLogout} className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger)', marginTop: 'auto' }}>
          <LogOut size={18} /> Logout
        </button>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
