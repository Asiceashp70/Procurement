import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CompanyAdminPage } from './pages/CompanyAdminPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { NewDocumentPage } from './pages/NewDocumentPage';
import { VerifyPage } from './pages/VerifyPage';
import { ConsentGate } from './pages/ConsentGate';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { SearchPage } from './pages/SearchPage';
import { SuperAdminPage } from './pages/SuperAdminPage';

// pdf.js is large: load it only on the pages that render PDFs
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));
const DocumentViewPage = lazy(() => import('./pages/DocumentViewPage').then((m) => ({ default: m.DocumentViewPage })));
const SignPage = lazy(() => import('./pages/SignPage').then((m) => ({ default: m.SignPage })));
import { SessionProvider, useSession } from './session';

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RequireLogin allowUnregistered><RegisterPage /></RequireLogin>} />
          <Route path="/" element={<RequireLogin><Shell><HomePage /></Shell></RequireLogin>} />
          <Route path="/join" element={<RequireLogin><Shell><JoinPage /></Shell></RequireLogin>} />
          <Route path="/join/:token" element={<RequireLogin><Shell><JoinPage /></Shell></RequireLogin>} />
          <Route path="/documents" element={<RequireLogin><Shell><DocumentsPage /></Shell></RequireLogin>} />
          <Route path="/documents/new" element={<RequireLogin><Shell><NewDocumentPage /></Shell></RequireLogin>} />
          <Route path="/documents/:id" element={<RequireLogin><Shell><DocumentDetailPage /></Shell></RequireLogin>} />
          <Route path="/documents/:id/edit" element={<RequireLogin><Shell wide><EditorPage /></Shell></RequireLogin>} />
          <Route path="/documents/:id/sign" element={<RequireLogin><Shell><SignPage /></Shell></RequireLogin>} />
          <Route path="/documents/:id/view" element={<RequireLogin><Shell><DocumentViewPage /></Shell></RequireLogin>} />
          <Route path="/search" element={<RequireLogin><Shell><SearchPage /></Shell></RequireLogin>} />
          <Route path="/verify" element={<RequireLogin><Shell><VerifyPage /></Shell></RequireLogin>} />
          <Route path="/profile" element={<RequireLogin><Shell><ProfilePage /></Shell></RequireLogin>} />
          <Route path="/c/:companyId/admin" element={<RequireLogin><Shell wide><CompanyAdminPage /></Shell></RequireLogin>} />
          <Route path="/admin" element={<RequireLogin><Shell wide><SuperAdminPage /></Shell></RequireLogin>} />
          <Route path="*" element={<Shell><div className="card center"><h2>ไม่พบหน้านี้</h2><Link to="/">กลับหน้าแรก</Link></div></Shell>} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}

const NEXT_KEY = 'esign.next';
export const rememberNext = (path: string) => {
  try {
    sessionStorage.setItem(NEXT_KEY, path);
  } catch {
    /* ignore */
  }
};
export const takeNext = () => {
  try {
    const v = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return v && v.startsWith('/') && !v.startsWith('//') ? v : '/';
  } catch {
    return '/';
  }
};

function RequireLogin({ children, allowUnregistered }: { children: ReactNode; allowUnregistered?: boolean }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <div className="loading">กำลังโหลด...</div>;
  const here = loc.pathname + loc.search;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  if (!me.registered && !allowUnregistered) {
    rememberNext(here);
    return <Navigate to="/register" replace />;
  }
  if (me.registered && me.needsConsent) return <ConsentGate />;
  return <>{children}</>;
}

function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { me, logout } = useSession();
  const navigate = useNavigate();
  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          LINE e-Sign
        </Link>
        {me?.registered && (
          <>
            <Link to="/documents" className="small" style={{ fontWeight: 600 }}>
              เอกสาร
            </Link>
            <Link to="/search" className="small" style={{ fontWeight: 600 }}>
              ค้นหา
            </Link>
          </>
        )}
        <span className="spacer" />
        {me && (
          <>
            <Link to="/profile" className="row" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="ข้อมูลของฉัน">
              {me.linePictureUrl ? <img className="avatar" src={me.linePictureUrl} alt="" /> : <span className="avatar" />}
              <span className="small">{me.nickname || me.firstName || me.lineDisplayName}</span>
            </Link>
            <button className="btn-sm btn-ghost" onClick={() => logout().then(() => navigate('/login'))}>
              ออก
            </button>
          </>
        )}
      </header>
      <main className={wide ? 'page wide' : 'page'}>
        <Suspense fallback={<div className="loading">กำลังโหลด...</div>}>{children}</Suspense>
      </main>
    </>
  );
}
