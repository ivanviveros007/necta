import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { clearAllDrafts } from '../hooks/useDraft';
import { fakeSocket } from './fakeApi';

export function testClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
}

/** Monta la app completa en una ruta, con API y socket falsos. */
export function renderApp(path = '/') {
  window.history.pushState({}, '', path);
  clearAllDrafts();
  const socket = fakeSocket();
  const user = userEvent.setup();
  const utils = render(<App client={testClient()} socketFactory={socket.factory} />);
  return { ...utils, user, socket: socket.socket };
}
