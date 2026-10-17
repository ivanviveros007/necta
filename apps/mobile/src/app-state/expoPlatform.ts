import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { resolveApiUrl } from '../config/apiUrl';
import type { SqlDatabase } from '../db/sql';
import { createApiClient } from '../services/apiClient';
import { sessionStore } from '../services/sessionStore';
import type { Platform } from './NectaProvider';

/** Implementación real con módulos de Expo (SQLite, SecureStore, red, socket). */
export function createExpoPlatform(): Platform {
  const apiUrl = resolveApiUrl();
  return {
    api: createApiClient(apiUrl),
    sessions: sessionStore,
    async openDatabase(name) {
      const db = await SQLite.openDatabaseAsync(name);
      return db as unknown as SqlDatabase;
    },
    newId: () => Crypto.randomUUID(),
    onForeground(cb) {
      const sub = AppState.addEventListener('change', (state) => state === 'active' && cb());
      return () => sub.remove();
    },
    onReconnect(cb) {
      let wasConnected = true;
      const sub = Network.addNetworkStateListener((s) => {
        const connected = Boolean(s.isConnected);
        if (connected && !wasConnected) cb();
        wasConnected = connected;
      });
      return () => sub.remove();
    },
    onServerChange(token, cb) {
      // Solo avisa: el pull por cursor sigue siendo la fuente de verdad.
      const socket = io(apiUrl, { path: '/socket.io', transports: ['websocket'], auth: { token } });
      socket.on('store.changed', cb);
      socket.on('connect', cb);
      return () => {
        socket.removeAllListeners();
        socket.close();
      };
    },
  };
}

export const API_URL_FOR_DISPLAY = resolveApiUrl();
