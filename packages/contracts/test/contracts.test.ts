import { describe, expect, it } from 'vitest';
import {
  BankProjectionSchema,
  decodeCursor,
  DebtPaymentRequestSchema,
  encodeCursor,
  LocalDateSchema,
  SaleBatchRequestSchema,
  SyncOperationSchema,
} from '../src';

describe('Contratos del anexo', () => {
  it('acepta el ejemplo de ventas por lote tal cual', () => {
    const parsed = SaleBatchRequestSchema.parse({
      batchId: 'b_7f21',
      sales: [
        {
          clientMutationId: 'm_0193',
          sale: {
            customerId: 'cli_hotel_brisas',
            items: [{ itemId: 'prod_cloro_5l', quantitiesSold: 40, finalPrice: 52500 }],
            payments: [],
            saleDate: '2026-05-14',
            expiresAt: '2026-05-28',
          },
        },
      ],
    });
    expect(parsed.sales[0]!.sale.items[0]!.finalPrice).toBe(52500);
  });

  it('acepta el pago de cuenta por cobrar con clientMutationId como extensión', () => {
    const body = { clientMutationId: 'm_1', bankId: 'bank_caja', amount: 300000, method: 'transferencia', paymentDate: '2026-05-25' };
    expect(DebtPaymentRequestSchema.parse(body).amount).toBe(300000);
    expect(DebtPaymentRequestSchema.safeParse({ ...body, clientMutationId: undefined }).success).toBe(false);
  });

  it('proyección de bolsillo', () => {
    expect(BankProjectionSchema.parse({ storedLedgerBalance: 1300000, projectedBalance: 1040000, alignmentDelta: 260000 })).toBeTruthy();
  });
});

describe('Validación', () => {
  it('rechaza fechas inexistentes y montos no enteros o negativos', () => {
    expect(LocalDateSchema.safeParse('2026-02-30').success).toBe(false);
    const op = {
      clientMutationId: 'm_2',
      type: 'movement.create',
      payload: { movement: { id: 'mv_1', kind: 'expense', amount: -5, bankId: 'bank_caja', date: '2026-05-25' } },
    };
    expect(SyncOperationSchema.safeParse(op).success).toBe(false);
    op.payload.movement.amount = 45000.5;
    expect(SyncOperationSchema.safeParse(op).success).toBe(false);
    op.payload.movement.amount = 45000;
    expect(SyncOperationSchema.parse(op)).toMatchObject({ dependsOn: [], payload: { movement: { description: '' } } });
  });

  it('las ediciones exigen baseVersion', () => {
    const r = SyncOperationSchema.safeParse({ clientMutationId: 'm_3', type: 'commitment.update', entityId: 'c1', payload: { changes: { amount: 10 } } });
    expect(r.success).toBe(false);
  });

  it('un compromiso mensual exige días válidos', () => {
    const r = SyncOperationSchema.safeParse({
      clientMutationId: 'm_4',
      type: 'commitment.create',
      payload: { commitment: { id: 'c1', direction: 'outflow', concept: 'Arriendo', amount: 1300000, schedule: { kind: 'monthly', daysOfMonth: [32], startDate: '2026-01-01' } } },
    });
    expect(r.success).toBe(false);
  });
});

describe('Cursor opaco', () => {
  it('ida y vuelta', () => {
    for (const seq of [0, 1, 57, 123456789]) expect(decodeCursor(encodeCursor(seq))).toBe(seq);
    expect(encodeCursor(57)).not.toContain('57');
  });

  it('cursor vacío empieza desde cero; inválido devuelve null', () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor('***')).toBeNull();
    expect(decodeCursor(encodeCursor(1).slice(0, 3))).toBeNull();
  });
});

describe('Reprogramar cobro', () => {
  it('exige baseVersion y fecha válida', () => {
    expect(SyncOperationSchema.safeParse({ clientMutationId: 'r1', type: 'receivable.reschedule', entityId: 'rcv', baseVersion: 1, payload: { newDueDate: '2026-06-02' } }).success).toBe(true);
    expect(SyncOperationSchema.safeParse({ clientMutationId: 'r1', type: 'receivable.reschedule', entityId: 'rcv', payload: { newDueDate: '2026-06-02' } }).success).toBe(false);
    expect(SyncOperationSchema.safeParse({ clientMutationId: 'r1', type: 'receivable.reschedule', entityId: 'rcv', baseVersion: 1, payload: { newDueDate: '2026-02-31' } }).success).toBe(false);
  });
});
