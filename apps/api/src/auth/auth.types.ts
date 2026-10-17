import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ClientPlatform } from '@necta/contracts';
import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  email: string;
  storeIds: string[];
  via: 'bearer' | 'cookie';
  platform: ClientPlatform | null;
  expiresAt: string;
}

export interface StoreContext {
  id: string;
  name: string;
  currency: string;
  timeZone: string;
}

export interface NectaRequest extends Request {
  auth?: AuthContext;
  store?: StoreContext;
}

export const IS_PUBLIC = 'necta:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const STORE_SCOPED = 'necta:storeScoped';
/** Exige `x-store-id` de una tienda de la usuaria autenticada. */
export const StoreScoped = () => SetMetadata(STORE_SCOPED, true);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<NectaRequest>();
  if (!req.auth) throw new Error('Auth context missing');
  return req.auth;
});

export const Store = createParamDecorator((_: unknown, ctx: ExecutionContext): StoreContext => {
  const req = ctx.switchToHttp().getRequest<NectaRequest>();
  if (!req.store) throw new Error('Store context missing');
  return req.store;
});
