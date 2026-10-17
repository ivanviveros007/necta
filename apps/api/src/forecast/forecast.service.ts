import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { buildForecastInput, computeForecast, type StoreSnapshot } from '@necta/cash-engine';
import type { ForecastResponse } from '@necta/contracts';
import type { Model } from 'mongoose';
import { ClockService } from '../common/clock.service';
import {
  toBank,
  toCommitment,
  toCounterparty,
  toMovement,
  toPayable,
  toReceivable,
  toSale,
  type Doc,
} from '../db/mappers';
import { MODELS } from '../db/schemas';
import type { StoreContext } from '../auth/auth.types';

/** Arma la entrada del motor desde MongoDB y guarda un snapshot trazable del resultado. */
@Injectable()
export class ForecastService {
  constructor(
    @InjectModel(MODELS.Store) private readonly stores: Model<Doc>,
    @InjectModel(MODELS.Bank) private readonly banks: Model<Doc>,
    @InjectModel(MODELS.Counterparty) private readonly counterparties: Model<Doc>,
    @InjectModel(MODELS.Receivable) private readonly receivables: Model<Doc>,
    @InjectModel(MODELS.Payable) private readonly payables: Model<Doc>,
    @InjectModel(MODELS.Commitment) private readonly commitments: Model<Doc>,
    @InjectModel(MODELS.Movement) private readonly movements: Model<Doc>,
    @InjectModel(MODELS.Sale) private readonly sales: Model<Doc>,
    @InjectModel(MODELS.Baseline) private readonly baselines: Model<Doc>,
    @InjectModel(MODELS.Counter) private readonly counters: Model<Doc>,
    @InjectModel(MODELS.ForecastSnapshot) private readonly snapshots: Model<Doc>,
    private readonly clock: ClockService,
  ) {}

  async storeContext(storeId: string): Promise<StoreContext | null> {
    const s = await this.stores.findById(storeId).lean<Doc>();
    return s ? { id: s._id, name: s.name, currency: s.currency, timeZone: s.timeZone } : null;
  }

  async loadSnapshot(store: StoreContext): Promise<{ snapshot: StoreSnapshot; dataVersion: number }> {
    const storeId = store.id;
    const today = this.clock.businessDate(store.timeZone);
    const live = { storeId, deletedAt: null };
    const [banks, cps, recs, pays, cmts, movs, sales, baseline, counter] = await Promise.all([
      this.banks.find(live).lean<Doc[]>(),
      this.counterparties.find(live).lean<Doc[]>(),
      this.receivables.find({ ...live, pendingAmount: { $gt: 0 } }).lean<Doc[]>(),
      this.payables.find({ ...live, pendingAmount: { $gt: 0 } }).lean<Doc[]>(),
      this.commitments.find(live).lean<Doc[]>(),
      this.movements.find({ ...live, date: today }).lean<Doc[]>(),
      this.sales.find({ ...live, saleDate: today }).lean<Doc[]>(),
      this.baselines.findOne(live).lean<Doc>(),
      this.counters.findById(storeId).lean<Doc>(),
    ]);
    const snapshot: StoreSnapshot = {
      currency: store.currency,
      timeZone: store.timeZone,
      businessDate: today,
      todayPolicy: this.clock.todayPolicy(),
      banks: banks.map(toBank),
      counterparties: cps.map(toCounterparty),
      receivables: recs.map(toReceivable),
      payables: pays.map(toPayable),
      commitments: cmts.map(toCommitment),
      movements: movs.map(toMovement),
      sales: sales.map(toSale),
      baseline: baseline ? { weekdaySales: baseline.weekdaySales, weekdayExpenses: baseline.weekdayExpenses } : null,
    };
    return { snapshot, dataVersion: counter?.seq ?? 0 };
  }

  async compute(store: StoreContext): Promise<ForecastResponse> {
    const { snapshot, dataVersion } = await this.loadSnapshot(store);
    const result = computeForecast(buildForecastInput(snapshot));
    const response: ForecastResponse = {
      ...result,
      storeId: store.id,
      computedAt: this.clock.now().toISOString(),
      cutoff: this.clock.cutoff(store.timeZone),
      dataVersion,
      provisional: false,
      pendingOperations: 0,
    };
    await this.saveSnapshot(response);
    return response;
  }

  /** Guarda un snapshot por versión de datos y fecha de negocio (evita duplicar en cada consulta). */
  private async saveSnapshot(r: ForecastResponse): Promise<void> {
    const last = await this.snapshots.findOne({ storeId: r.storeId }).sort({ computedAt: -1 }).lean<Doc>();
    if (last && last.dataVersion === r.dataVersion && last.cutoff === r.cutoff) return;
    await this.snapshots.create({
      storeId: r.storeId,
      computedAt: new Date(r.computedAt),
      cutoff: r.cutoff,
      dataVersion: r.dataVersion,
      status: r.status,
      result: r,
    });
  }
}
