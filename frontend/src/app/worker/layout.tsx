'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
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
    if (parsed.role !== 'Employee') {
      router.push('/login');
      return;
    }
    setUser(parsed);
  }, [router]);

  if (!user) return null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderBottom: '1px solid var(--border)' }} className="flex-between">
        <h2 className="text-primary font-bold m-0 text-xl">Worker App</h2>
        <div className="flex-center" style={{ gap: '1rem' }}>
          <span className="text-muted">{user.full_name}</span>
          <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => { localStorage.clear(); router.push('/login'); }}>Logout</button>
        </div>
      </header>
      <main style={{ flex: 1, padding: '1rem' }}>
        {children}
      </main>
    </div>
  );
}
