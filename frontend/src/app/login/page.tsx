'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/auth/login', { username, password });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));

      if (res.data.user.role === 'Employee') {
        router.push('/worker');
      } else {
        router.push('/admin');
      }
    } catch (err) {
      setError('Invalid username หรือ Password ไม่ถูกต้อง');
    }
  };

  return (
    <div className="flex-center" style={{ minHeight: '100vh', padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <h2 className="text-center mb-4 text-2xl font-bold">PMS Login</h2>
        <p className="text-center text-muted mb-8">Production Management System</p>
        
        {error && <div className="badge badge-danger mb-4" style={{display: 'block', textAlign: 'center'}}>{error}</div>}

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="label">Username / Employee ID</label>
            <input 
              type="text" 
              className="input" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              required 
            />
          </div>
          <div className="mb-8">
            <label className="label">Password / PIN</label>
            <input 
              type="password" 
              className="input" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required 
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            เข้าระบบ (Login)
          </button>
        </form>
      </div>
    </div>
  );
}
