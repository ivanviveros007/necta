import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, Interval } from '@nestjs/schedule';
import { localDateInZone } from '@necta/cash-engine';
import type { Model } from 'mongoose';
import { ClockService } from '../common/clock.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Doc } from '../db/mappers';
import { MODELS } from '../db/schemas';
import { StoreEvents } from '../events/store-events';
import { ForecastService } from '../forecast/forecast.service';
import { AlertsService, type AlertDecision } from './alerts.service';
import { DeliveryService } from './delivery.service';

/**
 * Revisión de caja: diaria (hora local de la tienda) y tras cambios relevantes, agrupados por tienda
 * en una cola persistida en MongoDB (sobrevive reinicios). @nestjs/schedule dispara los ciclos.
 */
@Injectable()
export class ReviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ReviewService');
  private unsubscribe: (() => void) | null = null;
  private running = false;

  constructor(
    @InjectModel(MODELS.ReviewQueue) private readonly queue: Model<Doc>,
    @InjectModel(MODELS.Store) private readonly stores: Model<Doc>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: ClockService,
    private readonly events: StoreEvents,
    private readonly forecast: ForecastService,
    private readonly alerts: AlertsService,
    private readonly deliveries: DeliveryService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.onChanged(({ storeId, type }) => {
      void this.enqueue(storeId, type).catch((e) => this.logger.error(e));
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /** Agrupa: el primer cambio fija el vencimiento del lote; los siguientes solo suman motivos. */
  async enqueue(storeId: string, reason: string, delayMs = this.config.reviewBatchMs): Promise<void> {
    await this.queue.updateOne(
      { _id: storeId },
      { $setOnInsert: { dueAt: new Date(this.clock.now().getTime() + delayMs) }, $addToSet: { reasons: reason } },
      { upsert: true },
    );
  }

  async processDue(now: Date = this.clock.now()): Promise<{ storeId: string; decision: AlertDecision }[]> {
    const done: { storeId: string; decision: AlertDecision }[] = [];
    for (;;) {
      const item = await this.queue.findOneAndDelete({ dueAt: { $lte: now } }, { sort: { dueAt: 1 } }).lean<Doc>();
      if (!item) break;
      try {
        done.push({ storeId: item._id, decision: await this.reviewStore(item._id) });
      } catch (error) {
        this.logger.error(`Revisión fallida para ${item._id}: ${String(error)}`);
        await this.enqueue(item._id, 'retry', 60_000);
      }
    }
    return done;
  }

  async reviewStore(storeId: string): Promise<AlertDecision> {
    const store = await this.forecast.storeContext(storeId);
    if (!store) return 'none';
    const result = await this.forecast.compute(store);
    const { decision } = await this.alerts.evaluate(storeId, result);
    this.logger.log(`Revisión ${store.name}: ${result.status} → alerta ${decision}`);
    return decision;
  }

  /** Encola la revisión diaria de cada tienda una vez por fecha local, desde la hora configurada. */
  async enqueueDaily(now: Date = this.clock.now()): Promise<number> {
    let count = 0;
    for (const s of await this.stores.find().lean<Doc[]>()) {
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: s.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
      const today = this.config.businessDate ?? localDateInZone(now, s.timeZone);
      if (hour < this.config.dailyReviewHour || s.lastDailyReviewDate === today) continue;
      const claimed = await this.stores.updateOne({ _id: s._id, lastDailyReviewDate: { $ne: today } }, { $set: { lastDailyReviewDate: today } });
      if (claimed.modifiedCount === 1) {
        await this.enqueue(s._id, 'daily', 0);
        count += 1;
      }
    }
    return count;
  }

  // ---------- Disparadores programados ----------

  @Cron('*/10 * * * *', { name: 'daily-review' })
  async dailyTick(): Promise<void> {
    if (this.config.schedulerEnabled) await this.enqueueDaily();
  }

  @Interval('review-queue', 5_000)
  async queueTick(): Promise<void> {
    if (!this.config.schedulerEnabled || this.running) return;
    this.running = true;
    try {
      await this.processDue();
    } finally {
      this.running = false;
    }
  }

  @Interval('deliveries', 3_000)
  async deliveryTick(): Promise<void> {
    if (!this.config.schedulerEnabled) return;
    await this.deliveries.processDue();
    await this.deliveries.checkReceipts();
  }
}
