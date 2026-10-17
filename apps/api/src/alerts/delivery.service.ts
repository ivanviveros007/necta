import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { Model } from 'mongoose';
import { ClockService } from '../common/clock.service';
import type { Doc } from '../db/mappers';
import { MODELS } from '../db/schemas';
import { EMAIL_ADAPTER, PUSH_ADAPTER, type EmailAdapter, type PushAdapter } from './adapters';
import { emailTemplate, toAlert } from './alerts.service';

export const MAX_ATTEMPTS = 5;
export const RECEIPT_DELAY_MS = 5_000;

/** Espera exponencial con jitter: 1 s, 2 s, 4 s… hasta 5 min. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** (attempts - 1), 300_000);
  return Math.round(base * (0.5 + random() / 2));
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('DeliveryService');

  constructor(
    @InjectModel(MODELS.NotificationDelivery) private readonly deliveries: Model<Doc>,
    @InjectModel(MODELS.User) private readonly users: Model<Doc>,
    @InjectModel(MODELS.Alert) private readonly alerts: Model<Doc>,
    @InjectModel(MODELS.Preference) private readonly preferences: Model<Doc>,
    @Inject(PUSH_ADAPTER) private readonly push: PushAdapter,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly clock: ClockService,
  ) {}

  /** Envía entregas pendientes o en reintento cuyo momento llegó. */
  async processDue(now: Date = this.clock.now()): Promise<number> {
    // Recuperación: una entrega que quedó «enviando» (caída del proceso) vuelve a reintento.
    await this.deliveries.updateMany(
      { status: 'sending', updatedAt: { $lt: new Date(now.getTime() - 60_000) } },
      { $set: { status: 'retry', nextAttemptAt: now } },
    );
    let processed = 0;
    for (;;) {
      // Reclamar de a una (status → sending) evita doble envío con varios workers.
      const d = await this.deliveries
        .findOneAndUpdate(
          { status: { $in: ['pending', 'retry'] }, nextAttemptAt: { $lte: now } },
          { $set: { status: 'sending', updatedAt: now }, $inc: { attempts: 1 } },
          { returnDocument: 'after', sort: { nextAttemptAt: 1 } },
        )
        .lean<Doc>();
      if (!d) break;
      processed += 1;
      await (d.channel === 'push' ? this.sendPush(d, now) : this.sendEmail(d, now));
    }
    return processed;
  }

  private async sendPush(d: Doc, now: Date): Promise<void> {
    try {
      const ticket = await this.push.send({ to: d.recipient, title: d.subject, body: d.body, data: { alertId: d.alertId } });
      if (ticket.status === 'ok') {
        await this.set(d._id, { status: 'sent', ticketId: ticket.id, receiptCheckAt: new Date(now.getTime() + RECEIPT_DELAY_MS), lastError: null });
      } else {
        await this.set(d._id, { status: 'failed', lastError: ticket.message ?? 'ticket con error' });
        await this.fallbackToEmail(d, now);
      }
    } catch (error) {
      await this.retryOrFail(d, now, error, true);
    }
  }

  private async sendEmail(d: Doc, now: Date): Promise<void> {
    try {
      await this.email.send({ email: d.recipient, subject: d.subject, template: d.body });
      await this.set(d._id, { status: 'sent', lastError: null });
    } catch (error) {
      await this.retryOrFail(d, now, error, false);
    }
  }

  private async retryOrFail(d: Doc, now: Date, error: unknown, fallback: boolean): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (d.attempts >= MAX_ATTEMPTS) {
      await this.set(d._id, { status: 'failed', lastError: message, nextAttemptAt: null });
      if (fallback) await this.fallbackToEmail(d, now);
      return;
    }
    await this.set(d._id, { status: 'retry', lastError: message, nextAttemptAt: new Date(now.getTime() + backoffMs(d.attempts)) });
  }

  /** Aceptación del push ≠ entrega: se consulta el recibo y, si falla, se usa correo. */
  async checkReceipts(now: Date = this.clock.now()): Promise<number> {
    const due = await this.deliveries.find({ channel: 'push', status: 'sent', receiptCheckAt: { $lte: now } }).limit(100).lean<Doc[]>();
    if (due.length === 0) return 0;
    const receipts = await this.push.getReceipts(due.map((d) => d.ticketId).filter(Boolean));
    for (const d of due) {
      const r = receipts[d.ticketId];
      if (!r) continue; // aún sin recibo: se vuelve a consultar
      if (r.status === 'ok') {
        await this.set(d._id, { status: 'delivered', receipt: 'ok' });
      } else {
        await this.set(d._id, { status: 'failed', receipt: 'error', lastError: r.message ?? 'recibo con error' });
        await this.fallbackToEmail(d, now);
      }
    }
    return due.length;
  }

  private async fallbackToEmail(d: Doc, now: Date): Promise<void> {
    const prefs = (await this.preferences.findById(d.userId).lean<Doc>()) ?? { emailFallback: true };
    if (prefs.emailFallback === false) return;
    const exists = await this.deliveries.exists({ alertId: d.alertId, round: d.round, channel: 'email' });
    if (exists) return;
    const user = await this.users.findById(d.userId).lean<Doc>();
    const alert = await this.alerts.findById(d.alertId).lean<Doc>();
    if (!user || !alert) return;
    await this.deliveries.create({
      _id: randomUUID(),
      storeId: d.storeId,
      alertId: d.alertId,
      userId: d.userId,
      round: d.round,
      channel: 'email',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      recipient: user.email,
      subject: `Necta · ${alert.headline}`,
      body: emailTemplate(toAlert(alert)),
      createdAt: now,
      updatedAt: now,
    });
    this.logger.log(`Respaldo por correo para la alerta ${d.alertId}`);
  }

  private async set(id: string, fields: Doc): Promise<void> {
    await this.deliveries.updateOne({ _id: id }, { $set: { ...fields, updatedAt: this.clock.now() } });
  }

  async list(storeId?: string): Promise<Doc[]> {
    return this.deliveries.find(storeId ? { storeId } : {}).sort({ createdAt: -1 }).limit(50).lean<Doc[]>();
  }
}
