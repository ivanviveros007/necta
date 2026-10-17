import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { api } from './api/endpoints';
import { AlertBanner, AppShell, OfflineBanner, QuickEntry } from './components/layout';
import { useAlerts } from './hooks/queries';
import { useOnline } from './hooks/useOnline';
import { useStoreEvents, type SocketFactory } from './hooks/useStoreEvents';
import { CommitmentsPage, DetailPage, HomePage, LoginPage, RecordPage } from './pages/pages';
import { SessionProvider, useAuthenticated, useSession } from './session/SessionProvider';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Web con conexión obligatoria: al volver la red, TanStack vuelve a consultar.
      queries: { retry: 1, refetchOnReconnect: true, refetchOnWindowFocus: true, staleTime: 5_000 },
    },
  });
}

function AuthenticatedApp({ socketFactory }: { socketFactory?: SocketFactory }) {
  const { user, store } = useAuthenticated();
  const { logout } = useSession();
  const online = useOnline();
  const navigate = useNavigate();
  const alerts = useAlerts();
  const queryClient = useQueryClient();
  const ack = useMutation({ mutationFn: api.ackAlert, onSuccess: () => queryClient.invalidateQueries() });
  useStoreEvents(true, socketFactory);

  return (
    <AppShell
      storeName={store.name}
      userName={user.name}
      onLogout={() => void logout()}
      banners={
        <>
          <OfflineBanner online={online} />
          <AlertBanner alerts={alerts.data ?? []} onAcknowledge={(id) => ack.mutate(id)} />
        </>
      }
      fab={<QuickEntry online={online} businessDate={store.businessDate} onIsCollection={() => navigate('/registrar/cobro')} />}
    >
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/detalle" element={<DetailPage />} />
        <Route path="/registrar" element={<RecordPage />} />
        <Route path="/registrar/:tipo" element={<RecordPage />} />
        <Route path="/compromisos" element={<CommitmentsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

function Gate({ socketFactory }: { socketFactory?: SocketFactory }) {
  const { session } = useSession();
  if (session.status === 'loading') return <p role="status">Cargando…</p>;
  if (session.status === 'anonymous') return <LoginPage />;
  return <AuthenticatedApp socketFactory={socketFactory} />;
}

export function App({ client, socketFactory }: { client?: QueryClient; socketFactory?: SocketFactory }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <Gate socketFactory={socketFactory} />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
