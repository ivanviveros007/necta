import type { ForecastResult } from '@necta/cash-engine';
import { z } from 'zod';

/** GET /v2/forecast/14d: resultado del motor + trazabilidad del cálculo. */
export interface ForecastResponse extends ForecastResult {
  storeId: string;
  computedAt: string;
  /** Instante de corte: inicio de la fecha de negocio (fullDay) o instante de cálculo (none). */
  cutoff: string;
  /** seq de la tienda incluido en el cálculo. */
  dataVersion: number;
  provisional: boolean;
  pendingOperations: number;
}

export const AlertSeveritySchema = z.enum(['depends', 'short']);

export interface AlertEntity {
  id: string;
  storeId: string;
  dedupKey: string;
  kind: 'shortfall';
  scenario: 'expected' | 'conservative';
  severity: 'depends' | 'short';
  shortfallDate: string;
  amount: number;
  headline: string;
  detail: string;
  status: 'active' | 'resolved';
  acknowledgedAt: string | null;
  notifiedCount: number;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryChannel = 'push' | 'email';
export type DeliveryStatus = 'pending' | 'retry' | 'sent' | 'delivered' | 'failed' | 'skipped';

export interface NotificationDeliveryEntity {
  id: string;
  alertId: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  ticketId: string | null;
  receipt: string | null;
  lastError: string | null;
  recipient: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export const DeviceRequestSchema = z.object({
  expoPushToken: z.string().min(10).max(200),
  platform: z.enum(['android', 'ios']),
  timeZone: z.string().min(1).max(64),
});

export const PreferencesRequestSchema = z.object({
  receivableDueSoon: z.boolean().optional(),
  receivableOverdue: z.boolean().optional(),
  payableDueSoon: z.boolean().optional(),
  /** Extensiones */
  cashShortfall: z.boolean().optional(),
  emailFallback: z.boolean().optional(),
});
export type Preferences = Required<z.infer<typeof PreferencesRequestSchema>>;
