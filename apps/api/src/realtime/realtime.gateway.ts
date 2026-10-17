import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { SESSION_COOKIE } from '@necta/contracts';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { StoreEvents } from '../events/store-events';

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Aviso de cambios en tiempo real. Solo notifica: el cliente vuelve a consultar o sincroniza.
 * Un evento perdido no pierde datos porque el pull por cursor es la fuente de verdad.
 */
@WebSocketGateway({ path: '/socket.io', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('RealtimeGateway');
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly events: StoreEvents,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.onChanged(({ storeId, seq, type }) => {
      this.server?.to(`store:${storeId}`).emit('store.changed', { storeId, seq, type });
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const bearer = typeof client.handshake.auth?.token === 'string' ? (client.handshake.auth.token as string) : null;
      const cookie = readCookie(client.handshake.headers.cookie, SESSION_COOKIE);
      if (!bearer && cookie) {
        // Con cookie, solo orígenes permitidos (evita secuestro de WebSocket entre sitios).
        const origin = client.handshake.headers.origin;
        if (!origin || !this.config.webOrigins.includes(origin)) throw new Error('origin');
      }
      const token = bearer ?? cookie;
      if (!token) throw new Error('token');
      const payload = await this.auth.verify(token);
      const found = await this.auth.userWithStores(payload.sub);
      if (!found) throw new Error('user');
      await client.join(found.storeIds.map((id) => `store:${id}`));
      client.emit('ready', { stores: found.storeIds });
    } catch {
      client.emit('unauthorized');
      client.disconnect(true);
    }
  }
}
