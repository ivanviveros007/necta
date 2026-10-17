import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { decodeCursor, SyncPushRequestSchema, type SyncPullResponse, type SyncPushResponse } from '@necta/contracts';
import { Auth, Store, StoreScoped, type AuthContext, type StoreContext } from '../auth/auth.types';
import { AppError, parseBody } from '../common/errors';
import { OperationsService } from '../operations/operations.service';
import { SyncService } from './sync.service';

@StoreScoped()
@Controller('v2/sync')
export class SyncController {
  constructor(
    private readonly ops: OperationsService,
    private readonly sync: SyncService,
  ) {}

  /** Respuesta por operación; 409 de payload distinto va como `rejected` con su código, no como conflicto de versión. */
  @Post('push')
  @HttpCode(200)
  async push(@Auth() auth: AuthContext, @Store() store: StoreContext, @Body() body: unknown): Promise<SyncPushResponse> {
    const { operations } = parseBody(SyncPushRequestSchema, body);
    const results = await this.ops.applyMany(
      { storeId: store.id, userId: auth.userId, platform: auth.platform, timeZone: store.timeZone },
      operations,
    );
    return { results };
  }

  @Get('pull')
  async pull(@Store() store: StoreContext, @Query('cursor') cursor?: string, @Query('limit') limitRaw?: string): Promise<SyncPullResponse> {
    const after = decodeCursor(cursor);
    if (after === null) throw new AppError('INVALID_CURSOR', 'Cursor inválido', HttpStatus.BAD_REQUEST);
    const limit = Math.min(Math.max(Number(limitRaw ?? 200) || 200, 1), 500);
    return this.sync.pull(store.id, after, limit);
  }
}
