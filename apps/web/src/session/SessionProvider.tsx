import type { SessionUser, StoreInfo } from '@necta/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onUnauthorized, setSessionHeaders } from '../api/client';
import { api } from '../api/endpoints';

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; expired?: boolean }
  | { status: 'authenticated'; user: SessionUser; store: StoreInfo };

interface SessionContextValue {
  session: SessionState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const queryClient = useQueryClient();

  const apply = useCallback((user: SessionUser, stores: StoreInfo[], csrf: string | undefined) => {
    const store = stores[0];
    if (!store) {
      setSession({ status: 'anonymous' });
      return;
    }
    setSessionHeaders(store.id, csrf ?? null);
    setSession({ status: 'authenticated', user, store });
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((r) => alive && apply(r.user, r.stores, r.csrfToken))
      .catch(() => alive && setSession({ status: 'anonymous' }));
    return () => {
      alive = false;
    };
  }, [apply]);

  useEffect(
    () =>
      onUnauthorized(() => {
        setSessionHeaders(null, null);
        queryClient.clear();
        setSession({ status: 'anonymous', expired: true });
      }),
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api.login(email, password);
      apply(r.user, r.stores, r.csrfToken);
    },
    [apply],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSessionHeaders(null, null);
    queryClient.clear();
    setSession({ status: 'anonymous' });
  }, [queryClient]);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession fuera de SessionProvider');
  return ctx;
}

/** Para componentes que solo se montan con sesión. */
export function useAuthenticated() {
  const { session } = useSession();
  if (session.status !== 'authenticated') throw new Error('Sin sesión');
  return session;
}
