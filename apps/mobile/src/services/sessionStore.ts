import type { SessionUser, StoreInfo } from '@necta/contracts';
import * as SecureStore from 'expo-secure-store';

export interface StoredSession {
  token: string;
  expiresAt: string;
  user: SessionUser;
  store: StoreInfo;
}

const KEY = 'necta.session.v1';

/** JWT y datos de sesión en el llavero del sistema (SecureStore), nunca en SQLite. */
export const sessionStore = {
  async load(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  },
  async save(session: StoredSession): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  },
  /** Olvida el token; la base local con pendientes se conserva. */
  async clearToken(): Promise<void> {
    const current = await this.load();
    if (!current) return;
    await SecureStore.setItemAsync(KEY, JSON.stringify({ ...current, token: '', expiresAt: new Date(0).toISOString() }));
  },
};

export function isExpired(session: Pick<StoredSession, 'token' | 'expiresAt'>, now = Date.now()): boolean {
  return !session.token || new Date(session.expiresAt).getTime() <= now;
}
