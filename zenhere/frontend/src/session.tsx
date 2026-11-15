import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type AuthConfig, type Me } from './lib/api';

interface SessionValue {
  me: Me | null;
  config: AuthConfig | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>('/me');
      setMe(m);
      return m;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        return null;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    Promise.all([api.get<AuthConfig>('/auth/config').then(setConfig), refresh()]).finally(() => setLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setMe(null);
  }, []);

  return <SessionContext.Provider value={{ me, config, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** The company the user is working in (REG-05: one LINE account, many companies). */
const ACTIVE_KEY = 'zenhere.activeCompany';
export function getActiveCompany(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function setActiveCompany(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* private mode: selection just isn't remembered */
  }
}

/** The approved membership the user is working in (falls back to the first one). */
export function useActiveMembership() {
  const { me } = useSession();
  const approved = (me?.memberships ?? []).filter((m) => m.status === 'approved' && m.companyStatus === 'active');
  const id = getActiveCompany();
  return approved.find((m) => m.companyId === id) ?? approved[0] ?? null;
}
