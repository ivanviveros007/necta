import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushTicket {
  id: string | null;
  status: 'ok' | 'error';
  message?: string;
}

export interface PushReceipt {
  status: 'ok' | 'error';
  message?: string;
}

/** Contrato del servicio de push de Expo: ticket al enviar; recibo de entrega se consulta aparte. */
export interface PushAdapter {
  send(message: PushMessage): Promise<PushTicket>;
  getReceipts(ticketIds: string[]): Promise<Record<string, PushReceipt>>;
}

/** Contrato del servicio interno de mensajería: POST {MESSAGING_SERVICE_URL}/v1/email/send. */
export interface EmailAdapter {
  send(email: { email: string; subject: string; template: string }): Promise<void>;
}

export const PUSH_ADAPTER = Symbol('PUSH_ADAPTER');
export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');

/** Perillas para simular fallas en local y en pruebas. Nunca se envían mensajes reales. */
@Injectable()
export class SimulationState {
  pushThrowNext = 0;
  pushTicketError = false;
  pushReceipt: 'ok' | 'error' | 'pending' = 'ok';
  emailFailNext = 0;

  reset(): void {
    this.pushThrowNext = 0;
    this.pushTicketError = false;
    this.pushReceipt = 'ok';
    this.emailFailNext = 0;
  }
}

@Injectable()
export class SimulatedPushAdapter implements PushAdapter {
  private readonly logger = new Logger('SimulatedPush');
  private readonly tickets = new Map<string, PushReceipt>();

  constructor(private readonly sim: SimulationState) {}

  async send(message: PushMessage): Promise<PushTicket> {
    if (this.sim.pushThrowNext > 0) {
      this.sim.pushThrowNext -= 1;
      throw new Error('Simulado: el servicio de push no respondió');
    }
    if (this.sim.pushTicketError) return { id: null, status: 'error', message: 'DeviceNotRegistered (simulado)' };
    const id = `ticket_${randomUUID()}`;
    this.tickets.set(id, this.sim.pushReceipt === 'error' ? { status: 'error', message: 'MessageRateExceeded (simulado)' } : { status: 'ok' });
    this.logger.log(`[simulado] push a ${message.to}: ${message.title}`);
    return { id, status: 'ok' };
  }

  async getReceipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    if (this.sim.pushReceipt === 'pending') return {};
    return Object.fromEntries(ticketIds.filter((id) => this.tickets.has(id)).map((id) => [id, this.tickets.get(id)!]));
  }
}

@Injectable()
export class SimulatedEmailAdapter implements EmailAdapter {
  private readonly logger = new Logger('SimulatedEmail');

  constructor(private readonly sim: SimulationState) {}

  async send(email: { email: string; subject: string; template: string }): Promise<void> {
    if (this.sim.emailFailNext > 0) {
      this.sim.emailFailNext -= 1;
      throw new Error('Simulado: el servicio de mensajería respondió 503');
    }
    this.logger.log(`[simulado] correo a ${email.email}: ${email.subject}`);
  }
}
