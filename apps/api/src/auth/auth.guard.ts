import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ClientPlatformSchema,
  CSRF_COOKIE,
  HEADER_CSRF,
  HEADER_PLATFORM,
  HEADER_STORE,
  SESSION_COOKIE,
} from '@necta/contracts';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuthService } from './auth.service';
import { IS_PUBLIC, STORE_SCOPED, type NectaRequest } from './auth.types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Autenticación por Bearer (móvil) o cookie HttpOnly (web). Con cookie, las requests que cambian datos
 * exigen Origin permitido y token CSRF de doble envío. `x-client-platform` identifica, no autoriza.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<NectaRequest>();
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE] ?? null;
    const token = bearer || cookie;
    if (!token) throw new AppError('UNAUTHENTICATED', 'Inicia sesión', HttpStatus.UNAUTHORIZED);

    const via = bearer ? 'bearer' : 'cookie';
    if (via === 'cookie' && !SAFE_METHODS.has(req.method)) this.checkCsrf(req);

    const payload = await this.auth.verify(token);
    const found = await this.auth.userWithStores(payload.sub);
    if (!found) throw new AppError('UNAUTHENTICATED', 'Usuaria inexistente', HttpStatus.UNAUTHORIZED);

    const platform = ClientPlatformSchema.safeParse(req.headers[HEADER_PLATFORM]);
    req.auth = {
      userId: found.user.id,
      email: found.user.email,
      storeIds: found.storeIds,
      via,
      platform: platform.success ? platform.data : null,
      expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
    };

    if (this.reflector.getAllAndOverride<boolean>(STORE_SCOPED, targets)) {
      const storeId = req.headers[HEADER_STORE];
      if (typeof storeId !== 'string' || !found.storeIds.includes(storeId)) {
        throw new AppError('STORE_FORBIDDEN', 'No tienes acceso a esta tienda', HttpStatus.FORBIDDEN);
      }
      const store = await this.auth.store(storeId);
      if (!store) throw new AppError('STORE_FORBIDDEN', 'No tienes acceso a esta tienda', HttpStatus.FORBIDDEN);
      req.store = { id: store._id, name: store.name, currency: store.currency, timeZone: store.timeZone };
    }
    return true;
  }

  private checkCsrf(req: NectaRequest): void {
    const origin = req.headers.origin;
    if (!origin || !this.config.webOrigins.includes(origin)) {
      throw new AppError('CSRF_REJECTED', 'Origen no permitido', HttpStatus.FORBIDDEN);
    }
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    const headerToken = req.headers[HEADER_CSRF];
    if (!cookieToken || typeof headerToken !== 'string' || !safeEqual(cookieToken, headerToken)) {
      throw new AppError('CSRF_REJECTED', 'Token CSRF inválido', HttpStatus.FORBIDDEN);
    }
  }
}
