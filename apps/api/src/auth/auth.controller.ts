import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ClientPlatformSchema,
  CSRF_COOKIE,
  HEADER_PLATFORM,
  LoginRequestSchema,
  SESSION_COOKIE,
  type SessionResponse,
} from '@necta/contracts';
import type { CookieOptions, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { AppError, parseBody } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuthService } from './auth.service';
import { Auth, Public, type AuthContext, type NectaRequest } from './auth.types';

@Controller('v2/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private cookieOptions(httpOnly: boolean): CookieOptions {
    return {
      httpOnly,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      path: '/',
      maxAge: this.config.jwtTtlSeconds * 1000,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: NectaRequest, @Res({ passthrough: true }) res: Response): Promise<SessionResponse> {
    const platform = ClientPlatformSchema.safeParse(req.headers[HEADER_PLATFORM]);
    if (!platform.success) throw new AppError('VALIDATION_ERROR', 'Falta x-client-platform (mobile|web)');
    const { email, password } = parseBody(LoginRequestSchema, body);
    const { user, token, expiresAt } = await this.auth.login(email, password);
    const found = await this.auth.userWithStores(user.id);
    const stores = await this.auth.storesInfo(found?.storeIds ?? []);

    if (platform.data === 'mobile') return { user, stores, expiresAt, accessToken: token };

    const csrfToken = randomBytes(24).toString('base64url');
    res.cookie(SESSION_COOKIE, token, this.cookieOptions(true));
    res.cookie(CSRF_COOKIE, csrfToken, this.cookieOptions(false));
    return { user, stores, expiresAt, csrfToken };
  }

  @Get('me')
  async me(@Auth() auth: AuthContext, @Req() req: NectaRequest): Promise<SessionResponse> {
    const found = await this.auth.userWithStores(auth.userId);
    const stores = await this.auth.storesInfo(auth.storeIds);
    const csrfToken = auth.via === 'cookie' ? (req.cookies as Record<string, string>)[CSRF_COOKIE] : undefined;
    return { user: found!.user, stores, expiresAt: auth.expiresAt, csrfToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }
}
