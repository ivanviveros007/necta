import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { formatLongDate, formatMoney } from '@necta/cash-engine';
import type { AlertEntity, ForecastResponse } from '@necta/contracts';
import { randomUUID } from 'node:crypto';
import type { Model } from 'mongoose';
import { ClockService } from '../common/clock.service';
import type { Doc } from '../db/mappers';
import { MODELS } from '../db/schemas';

export type AlertDecision = 'none' | 'resolved' | 'created' | 'updated' | 'escalated' | 'unchanged';

export const toAlert = (d: Doc): AlertEntity => ({
  id: d._id,
  storeId: d.storeId,
  dedupKey: d.dedupKey,
  kind: d.kind,
  scenario: d.scenario,
  severity: d.severity,
  shortfallDate: d.shortfallDate,
  amount: d.amount,
  headline: d.headline,
  detail: d.detail,
  status: d.status,
  acknowledgedAt: d.acknowledgedAt ? new Date(d.acknowledgedAt).toISOString() : null,
  notifiedCount: d.notifiedCount,
  createdAt: new Date(d.createdAt).toISOString(),
  updatedAt: new Date(d.updatedAt).toISOString(),
});

/** Umbral para volver a notificar el mismo faltante. */
const WORSENING_RATIO = 1.1;

@Injectable()
export class AlertsService {
  constructor(
    @InjectModel(MODELS.Alert) private readonly alerts: Model<Doc>,
    @InjectModel(MODELS.NotificationDelivery) private readonly deliveries: Model<Doc>,
    @InjectModel(MODELS.Store) private readonly stores: Model<Doc>,
    @InjectModel(MODELS.User) private readonly users: Model<Doc>,
    @InjectModel(MODELS.Device) private readonly devices: Model<Doc>,
    @InjectModel(MODELS.Preference) private readonly preferences: Model<Doc>,
    private readonly clock: ClockService,
  ) {}

  /**
   * Una alerta por faltante (clave storeId:shortfall:escenario:fecha). Se notifica al crearla,
   * al cambiar de fecha/escenario (nueva clave) o si el monto empeora más de 10 %.
   */
  async evaluate(storeId: string, forecast: ForecastResponse): Promise<{ decision: AlertDecision; alert: AlertEntity | null }> {
    const exp = forecast.scenarios.expected.firstShortfall;
    const cons = forecast.scenarios.conservative.firstShortfall;
    const target = exp
      ? { scenario: 'expected' as const, severity: 'short' as const, shortfall: exp }
      : cons
        ? { scenario: 'conservative' as const, severity: 'depends' as const, shortfall: cons }
        : null;
    const now = this.clock.now();

    if (!target) {
      const r = await this.alerts.updateMany({ storeId, status: 'active' }, { $set: { status: 'resolved', updatedAt: now } });
      return { decision: r.modifiedCount > 0 ? 'resolved' : 'none', alert: null };
    }

    const dedupKey = `${storeId}:shortfall:${target.scenario}:${target.shortfall.date}`;
    await this.alerts.updateMany({ storeId, status: 'active', dedupKey: { $ne: dedupKey } }, { $set: { status: 'resolved', updatedAt: now } });

    const fields = {
      kind: 'shortfall',
      scenario: target.scenario,
      severity: target.severity,
      shortfallDate: target.shortfall.date,
      amount: target.shortfall.amount,
      headline: forecast.conclusion.headline,
      detail: forecast.conclusion.detail,
      status: 'active',
      updatedAt: now,
    };

    const existing = await this.alerts.findOne({ storeId, dedupKey }).lean<Doc>();
    if (!existing) {
      try {
        const doc = await this.alerts.create({ _id: randomUUID(), storeId, dedupKey, ...fields, createdAt: now });
        const alert = toAlert(doc.toObject());
        await this.notify(alert);
        return { decision: 'created', alert };
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        // Otra revisión concurrente la creó: seguir como existente.
      }
    }
    const current = existing ?? (await this.alerts.findOne({ storeId, dedupKey }).lean<Doc>())!;
    const reopened = current.status === 'resolved';
    const worsened = target.shortfall.amount > current.lastNotifiedAmount * WORSENING_RATIO;
    const updated = await this.alerts.findOneAndUpdate({ _id: current._id }, { $set: fields }, { returnDocument: 'after' }).lean<Doc>();
    const alert = toAlert(updated!);
    if (reopened || worsened) {
      await this.notify(alert);
      return { decision: 'escalated', alert };
    }
    return { decision: current.amount === target.shortfall.amount ? 'unchanged' : 'updated', alert };
  }

  /** Push si hay dispositivo y preferencia; si no, correo. El aviso en app/web es la alerta misma. */
  private async notify(alert: AlertEntity): Promise<void> {
    const store = await this.stores.findById(alert.storeId).lean<Doc>();
    if (!store) return;
    const user = await this.users.findById(store.ownerId).lean<Doc>();
    if (!user) return;
    const prefs = (await this.preferences.findById(user._id).lean<Doc>()) ?? { cashShortfall: true, emailFallback: true };
    const now = this.clock.now();
    const round = alert.notifiedCount + 1;
    await this.alerts.updateOne({ _id: alert.id }, { $set: { lastNotifiedAmount: alert.amount }, $inc: { notifiedCount: 1 } });
    alert.notifiedCount = round;
    if (prefs.cashShortfall === false) return;

    const subject = `Necta · ${alert.headline}`;
    const body = `${alert.detail} Abre Necta para ver qué hacer.`;
    const devices = await this.devices.find({ userId: user._id }).lean<Doc[]>();
    const base = { storeId: alert.storeId, alertId: alert.id, userId: user._id, attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now, round };
    if (devices.length > 0) {
      await this.deliveries.insertMany(
        devices.map((d) => ({ _id: randomUUID(), ...base, channel: 'push', status: 'pending', recipient: d.expoPushToken, subject: alert.headline, body })),
      );
    } else if (prefs.emailFallback !== false) {
      await this.deliveries.create({ _id: randomUUID(), ...base, channel: 'email', status: 'pending', recipient: user.email, subject, body: emailTemplate(alert) });
    }
  }

  async list(storeId: string): Promise<AlertEntity[]> {
    const docs = await this.alerts.find({ storeId }).sort({ status: 1, updatedAt: -1 }).limit(20).lean<Doc[]>();
    return docs.map(toAlert);
  }

  async acknowledge(storeId: string, id: string): Promise<AlertEntity | null> {
    const doc = await this.alerts.findOneAndUpdate({ _id: id, storeId }, { $set: { acknowledgedAt: this.clock.now() } }, { returnDocument: 'after' }).lean<Doc>();
    return doc ? toAlert(doc) : null;
  }
}

export function emailTemplate(alert: AlertEntity): string {
  return [
    '<html><body style="font-family:sans-serif;font-size:18px">',
    `<h1 style="font-size:24px">${escapeHtml(alert.headline)}</h1>`,
    `<p>${escapeHtml(alert.detail)}</p>`,
    `<p><strong>Faltante:</strong> ${formatMoney(alert.amount)} el ${formatLongDate(alert.shortfallDate)}.</p>`,
    '<p>Abre Necta para ver a quién cobrarle primero y qué pago negociar.</p>',
    '</body></html>',
  ].join('');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
