import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DeviceRequestSchema, PreferencesRequestSchema, type Preferences } from '@necta/contracts';
import type { Model } from 'mongoose';
import { Auth, Store, StoreScoped, type AuthContext, type StoreContext } from '../auth/auth.types';
import { ClockService } from '../common/clock.service';
import { AppError, parseBody } from '../common/errors';
import type { Doc } from '../db/mappers';
import { MODELS } from '../db/schemas';
import { SimulationState } from './adapters';
import { AlertsService } from './alerts.service';
import { DeliveryService } from './delivery.service';
import { ReviewService } from './review.service';

const DEFAULT_PREFS: Preferences = {
  receivableDueSoon: true,
  receivableOverdue: true,
  payableDueSoon: true,
  cashShortfall: true,
  emailFallback: true,
};

@StoreScoped()
@Controller('v2/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@Store() store: StoreContext) {
    return this.alerts.list(store.id);
  }

  @Post(':id/ack')
  @HttpCode(200)
  async ack(@Store() store: StoreContext, @Param('id') id: string) {
    const alert = await this.alerts.acknowledge(store.id, id);
    if (!alert) throw new AppError('NOT_FOUND', 'Alerta inexistente', HttpStatus.NOT_FOUND);
    return alert;
  }
}

/** Contratos existentes de push, con preferencias nuevas cashShortfall y emailFallback. */
@Controller('v2/push-notifications')
export class PushController {
  constructor(
    @InjectModel(MODELS.Device) private readonly devices: Model<Doc>,
    @InjectModel(MODELS.Preference) private readonly prefs: Model<Doc>,
    private readonly clock: ClockService,
  ) {}

  @Post('device')
  @HttpCode(200)
  async device(@Auth() auth: AuthContext, @Body() body: unknown) {
    const d = parseBody(DeviceRequestSchema, body);
    await this.devices.updateOne(
      { expoPushToken: d.expoPushToken },
      { $set: { userId: auth.userId, platform: d.platform, timeZone: d.timeZone, updatedAt: this.clock.now() }, $setOnInsert: { _id: d.expoPushToken } },
      { upsert: true },
    );
    return { ok: true };
  }

  @Get('preferences')
  async getPreferences(@Auth() auth: AuthContext): Promise<Preferences> {
    const doc = await this.prefs.findById(auth.userId).lean<Doc>();
    return { ...DEFAULT_PREFS, ...(doc ? strip(doc) : {}) };
  }

  @Put('preferences')
  async putPreferences(@Auth() auth: AuthContext, @Body() body: unknown): Promise<Preferences> {
    const changes = parseBody(PreferencesRequestSchema, body);
    const doc = await this.prefs.findOneAndUpdate({ _id: auth.userId }, { $set: changes }, { upsert: true, returnDocument: 'after' }).lean<Doc>();
    return { ...DEFAULT_PREFS, ...strip(doc!) };
  }
}

function strip(doc: Doc): Partial<Preferences> {
  const { _id, ...rest } = doc;
  void _id;
  return rest;
}

/** Solo en desarrollo: observar entregas simuladas y forzar revisiones. */
@StoreScoped()
@Controller('v2/dev')
export class DevController {
  constructor(
    private readonly review: ReviewService,
    private readonly deliveries: DeliveryService,
    private readonly sim: SimulationState,
  ) {}

  @Get('notifications')
  notifications(@Store() store: StoreContext, @Query('all') all?: string) {
    return this.deliveries.list(all ? undefined : store.id);
  }

  @Post('review')
  @HttpCode(200)
  async runReview(@Store() store: StoreContext) {
    const decision = await this.review.reviewStore(store.id);
    const sent = await this.deliveries.processDue();
    return { decision, deliveriesProcessed: sent };
  }

  @Post('process-deliveries')
  @HttpCode(200)
  async process() {
    const sent = await this.deliveries.processDue();
    const receipts = await this.deliveries.checkReceipts(new Date(Date.now() + 60_000));
    return { sent, receipts };
  }

  @Post('simulation')
  @HttpCode(200)
  simulation(@Body() body: Partial<SimulationState> & { reset?: boolean }) {
    if (body.reset) this.sim.reset();
    if (typeof body.emailFailNext === 'number') this.sim.emailFailNext = body.emailFailNext;
    if (typeof body.pushThrowNext === 'number') this.sim.pushThrowNext = body.pushThrowNext;
    if (typeof body.pushTicketError === 'boolean') this.sim.pushTicketError = body.pushTicketError;
    if (body.pushReceipt === 'ok' || body.pushReceipt === 'error' || body.pushReceipt === 'pending') this.sim.pushReceipt = body.pushReceipt;
    return { ...this.sim };
  }
}
