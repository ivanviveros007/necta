import type { SessionUser, StoreInfo } from '@necta/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LocalRepository } from '../db/localRepository';
import type { SqlDatabase } from '../db/sql';
import type { Draft } from '../domain/operations';
import { computeLocalView, type LocalView } from '../domain/provisionalForecast';
import type { ApiClient } from '../services/apiClient';
import { isExpired, type StoredSession } from '../services/sessionStore';
import { SyncCoordinator, type SyncState } from '../sync/syncCoordinator';

export interface Platform {
  api: ApiClient;
  sessions: { load(): Promise<StoredSession | null>; save(s: StoredSession): Promise<void>; clearToken(): Promise<void> };
  openDatabase(name: string): Promise<SqlDatabase>;
  newId(): string;
  /** Suscripciones a disparadores del sistema; devuelven la función para desuscribirse. */
  onForeground(cb: () => void): () => void;
  onReconnect(cb: () => void): () => void;
  onServerChange(token: string, cb: () => void): () => void;
}

export type SessionStatus = 'loading' | 'anonymous' | 'ready';

interface NectaContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  store: StoreInfo | null;
  /** Hay sesión local pero el token venció: se registra igual, sin sincronizar. */
  expired: boolean;
  repo: LocalRepository | null;
  sync: SyncState | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  record(draft: Draft): Promise<void>;
  syncNow(): Promise<void>;
  newId(): string;
}

const Ctx = createContext<NectaContextValue | null>(null);

export const dbName = (userId: string, storeId: string) => `necta_${userId}_${storeId}.db`;

export function NectaProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<StoredSession | null>(null);
  const [repo, setRepo] = useState<LocalRepository | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const coordinator = useRef<SyncCoordinator | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  sessionRef.current = session;
  const queryClient = useQueryClient();

  const start = useCallback(
    async (s: StoredSession) => {
      const db = await platform.openDatabase(dbName(s.user.id, s.store.id));
      const r = await LocalRepository.open(db);
      await r.saveStore(s.store);
      coordinator.current?.dispose();
      const c = new SyncCoordinator({
        repo: r,
        api: platform.api,
        storeId: s.store.id,
        getToken: async () => (sessionRef.current && !isExpired(sessionRef.current) ? sessionRef.current.token : null),
      });
      await c.init();
      c.subscribe(setSync);
      coordinator.current = c;
      setSync(c.getState());
      setRepo(r);
      setSession(s);
      setStatus('ready');
      sessionRef.current = s;
      void c.run();
    },
    [platform],
  );

  useEffect(() => {
    let alive = true;
    platform.sessions
      .load()
      .then(async (s) => {
        if (!alive) return;
        if (s && s.token) await start(s);
        else setStatus('anonymous');
      })
      .catch(() => alive && setStatus('anonymous'));
    return () => {
      alive = false;
    };
  }, [platform, start]);

  // Cada cambio local o conciliación invalida la vista (TanStack Query no reemplaza a la outbox).
  useEffect(() => {
    if (!repo) return;
    return repo.subscribe(() => void queryClient.invalidateQueries({ queryKey: ['localView'] }));
  }, [repo, queryClient]);

  useEffect(() => {
    if (status !== 'ready') return;
    const run = () => void coordinator.current?.run();
    const offs = [platform.onForeground(run), platform.onReconnect(run)];
    if (session?.token && !isExpired(session)) offs.push(platform.onServerChange(session.token, run));
    return () => offs.forEach((off) => off());
  }, [status, session, platform]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await platform.api.login(email, password);
      const store = r.stores[0];
      if (!store || !r.accessToken) throw new Error('La cuenta no tiene tiendas');
      const s: StoredSession = { token: r.accessToken, expiresAt: r.expiresAt, user: r.user, store };
      await platform.sessions.save(s);
      await start(s);
    },
    [platform, start],
  );

  const logout = useCallback(async () => {
    // Se olvida el token; la base local (con pendientes) queda para el próximo ingreso.
    await platform.sessions.clearToken();
    coordinator.current?.dispose();
    coordinator.current = null;
    setRepo(null);
    setSession(null);
    setSync(null);
    queryClient.clear();
    setStatus('anonymous');
  }, [platform, queryClient]);

  const record = useCallback(
    async (draft: Draft) => {
      if (!repo) throw new Error('Sin base local');
      await repo.record(draft.operation, draft.write);
      void coordinator.current?.run();
    },
    [repo],
  );

  const syncNow = useCallback(async () => {
    await coordinator.current?.run();
  }, []);

  const value = useMemo<NectaContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      store: session?.store ?? null,
      expired: session ? isExpired(session) : false,
      repo,
      sync,
      login,
      logout,
      record,
      syncNow,
      newId: platform.newId,
    }),
    [status, session, repo, sync, login, logout, record, syncNow, platform],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNecta(): NectaContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNecta fuera de NectaProvider');
  return ctx;
}

/** Proyección local (provisional si hay pendientes), recalculada tras cada cambio. */
export function useLocalView() {
  const { repo } = useNecta();
  return useQuery<LocalView | null>({
    queryKey: ['localView'],
    queryFn: () => (repo ? computeLocalView(repo) : Promise.resolve(null)),
    enabled: Boolean(repo),
    networkMode: 'always',
    staleTime: Infinity,
  });
}

export function useOutbox() {
  const { repo } = useNecta();
  return useQuery({
    queryKey: ['localView', 'outbox'],
    queryFn: () => repo!.outbox(),
    enabled: Boolean(repo),
    networkMode: 'always',
    staleTime: Infinity,
  });
}

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always' } } });
}

export function AppProviders({ platform, client, children }: { platform: Platform; client?: QueryClient; children: ReactNode }) {
  const [qc] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={qc}>
      <NectaProvider platform={platform}>{children}</NectaProvider>
    </QueryClientProvider>
  );
}
