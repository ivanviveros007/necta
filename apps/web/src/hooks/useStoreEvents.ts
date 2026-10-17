import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export type SocketFactory = () => Socket;

const defaultFactory: SocketFactory = () =>
  io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });

/**
 * Escucha `store.changed` y vuelve a consultar. Al reconectar el socket también vuelve a consultar:
 * un evento perdido no deja datos viejos.
 */
export function useStoreEvents(enabled: boolean, factory: SocketFactory = defaultFactory): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const socket = factory();
    const refresh = () => void queryClient.invalidateQueries();
    socket.on('ready', () => {
      setConnected(true);
      refresh();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('store.changed', refresh);
    return () => {
      socket.removeAllListeners();
      socket.close();
    };
  }, [enabled, factory, queryClient]);

  return { connected };
}
