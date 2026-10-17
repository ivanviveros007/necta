import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { encodeCursor, type Change, type EntityType, type SyncPullResponse } from '@necta/contracts';
import type { Model } from 'mongoose';
import { MAPPERS, type Doc } from '../db/mappers';
import { MODELS } from '../db/schemas';

/**
 * Pull incremental: cada entidad guarda el `seq` de su último cambio (contador por tienda,
 * monótono en orden de commit). Se devuelven entidades con seq > cursor, incluidos borrados lógicos.
 */
@Injectable()
export class SyncService {
  private readonly sources: { type: EntityType; model: Model<Doc> }[];

  constructor(
    @InjectModel(MODELS.Bank) banks: Model<Doc>,
    @InjectModel(MODELS.Counterparty) counterparties: Model<Doc>,
    @InjectModel(MODELS.Receivable) receivables: Model<Doc>,
    @InjectModel(MODELS.Payable) payables: Model<Doc>,
    @InjectModel(MODELS.Movement) movements: Model<Doc>,
    @InjectModel(MODELS.Commitment) commitments: Model<Doc>,
    @InjectModel(MODELS.Sale) sales: Model<Doc>,
    @InjectModel(MODELS.Baseline) baselines: Model<Doc>,
  ) {
    this.sources = [
      { type: 'bank', model: banks },
      { type: 'counterparty', model: counterparties },
      { type: 'receivable', model: receivables },
      { type: 'payable', model: payables },
      { type: 'movement', model: movements },
      { type: 'commitment', model: commitments },
      { type: 'sale', model: sales },
      { type: 'baseline', model: baselines },
    ];
  }

  async pull(storeId: string, afterSeq: number, limit: number): Promise<SyncPullResponse> {
    const perSource = await Promise.all(
      this.sources.map(async ({ type, model }) => {
        const docs = await model.find({ storeId, seq: { $gt: afterSeq } }).sort({ seq: 1 }).limit(limit + 1).lean<Doc[]>();
        return docs.map((d) => ({ type, doc: d }));
      }),
    );
    const merged = perSource.flat().sort((a, b) => a.doc.seq - b.doc.seq);
    let take = merged.slice(0, limit);
    if (take.length > 0 && merged.length > limit) {
      // No cortar en medio de un seq: una operación puede tocar varias entidades con el mismo seq.
      const lastSeq = take[take.length - 1]!.doc.seq;
      take = merged.filter((m) => m.doc.seq <= lastSeq);
    }
    const maxSeq = take.length > 0 ? take[take.length - 1]!.doc.seq : afterSeq;
    const changes = take.map(({ type, doc }) => ({ entityType: type, entity: MAPPERS[type](doc) }) as Change);
    return {
      changes,
      nextCursor: encodeCursor(maxSeq),
      hasMore: merged.length > take.length,
      maxSeq,
      serverTime: new Date().toISOString(),
    };
  }
}
