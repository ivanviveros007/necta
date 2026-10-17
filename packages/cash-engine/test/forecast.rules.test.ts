import { describe, expect, it } from 'vitest';
import {
  affectsStoredBalance,
  applyPendingOperations,
  buildForecastInput,
  computeForecast,
  formatMoney,
  limpiaYaSnapshot,
  localDateInZone,
  occurrencesBetween,
  startOfLocalDay,
  validateSchedule,
  type ForecastInput,
  type StoreSnapshot,
} from '../src';

function emptyInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    currency: 'COP',
    timeZone: 'America/Bogota',
    today: '2026-05-25',
    todayPolicy: 'fullDay',
    balance: { stored: 1_000_000, reconstructed: 1_000_000, asOf: null },
    realizedToday: { cashSales: 0, cashExpenses: 0 },
    receivables: [],
    payables: [],
    commitments: [],
    baseline: null,
    ...overrides,
  };
}

describe('Fechas locales', () => {
  it('la fecha de negocio sigue la zona de la tienda, no UTC', () => {
    expect(localDateInZone('2026-05-26T03:00:00Z', 'America/Bogota')).toBe('2026-05-25');
    expect(localDateInZone('2026-05-26T05:00:00Z', 'America/Bogota')).toBe('2026-05-26');
  });
});

describe('Recurrencias', () => {
  it('quincena 15 y 30 en una ventana que cruza de mes', () => {
    const s = { kind: 'monthly' as const, daysOfMonth: [15, 30], startDate: '2026-01-01' };
    expect(occurrencesBetween(s, '2026-05-25', '2026-06-20')).toEqual(['2026-05-30', '2026-06-15']);
  });

  it('día 30 en febrero cae el último día del mes', () => {
    const s = { kind: 'monthly' as const, daysOfMonth: [30], startDate: '2026-01-01' };
    expect(occurrencesBetween(s, '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
  });

  it('respeta vigencia: sin ocurrencias después de endDate', () => {
    const s = { kind: 'monthly' as const, daysOfMonth: [1], startDate: '2026-01-01', endDate: '2026-05-20' };
    expect(occurrencesBetween(s, '2026-05-25', '2026-06-07')).toEqual([]);
  });

  it('valida días del mes', () => {
    expect(validateSchedule({ kind: 'monthly', daysOfMonth: [0], startDate: '2026-01-01' })).toBe('daysOfMonth');
    expect(validateSchedule({ kind: 'once', date: '2026-02-30' })).toBe('date');
    expect(validateSchedule({ kind: 'once', date: '2026-02-28' })).toBeNull();
  });
});

describe('Corte temporal y realizado vs previsto', () => {
  const baseline = { weekdaySales: [0, 260_000, 260_000, 260_000, 260_000, 520_000, 520_000], weekdayExpenses: [0, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000] };

  it('fullDay: lo vendido hoy consume la base y el cierre de hoy no cambia', () => {
    const before = computeForecast(emptyInput({ baseline }));
    const after = computeForecast(
      emptyInput({ baseline, balance: { stored: 1_100_000, reconstructed: 1_100_000, asOf: null }, realizedToday: { cashSales: 100_000, cashExpenses: 0 } }),
    );
    const today = after.scenarios.expected.days[0]!;
    expect(today.inflows.find((f) => f.kind === 'baseline_sales')!.amount).toBe(160_000);
    expect(today.closing).toBe(before.scenarios.expected.days[0]!.closing);
  });

  it('fullDay: vender más que la base no genera base negativa', () => {
    const r = computeForecast(emptyInput({ baseline, realizedToday: { cashSales: 400_000, cashExpenses: 0 } }));
    expect(r.scenarios.expected.days[0]!.inflows.some((f) => f.kind === 'baseline_sales')).toBe(false);
  });

  it('none: hoy no estima ventas ni gastos; mañana sí', () => {
    const r = computeForecast(emptyInput({ baseline, todayPolicy: 'none' }));
    expect(r.scenarios.expected.days[0]!.inflows).toHaveLength(0);
    expect(r.scenarios.expected.days[0]!.outflows).toHaveLength(0);
    expect(r.scenarios.expected.days[1]!.totalIn).toBe(260_000);
  });

  it('sin base: no inventa ventas y pide cargarlas', () => {
    const r = computeForecast(emptyInput());
    expect(r.scenarios.expected.days.every((d) => d.totalIn === 0)).toBe(true);
    expect(r.assumptions.find((a) => a.code === 'baseline_sales_missing')?.missing).toBe(true);
    expect(r.assumptions.find((a) => a.code === 'recurring_missing')?.missing).toBe(true);
  });
});

describe('Cobros: reglas de inclusión', () => {
  const r = (overrides: Partial<ForecastInput['receivables'][number]>) => ({
    id: 'r1',
    counterpartyId: 'c1',
    counterpartyName: 'Clienta',
    pendingAmount: 100_000,
    dueDate: '2026-05-27',
    history: { payments: 3, onTime: 3, avgDaysLate: null },
    ...overrides,
  });

  it('historial insuficiente no suma', () => {
    const f = computeForecast(emptyInput({ receivables: [r({ history: { payments: 2, onTime: 2, avgDaysLate: null } })] }));
    expect(f.unscheduledReceivables[0]!.reason).toBe('insufficient_history');
  });

  it('vence después de la ventana: no suma ni se recomienda cobrar', () => {
    const f = computeForecast(emptyInput({ receivables: [r({ dueDate: '2026-06-20' })] }));
    expect(f.unscheduledReceivables[0]!.reason).toBe('due_after_window');
  });

  it('pendiente cero se ignora (deuda cancelada)', () => {
    const f = computeForecast(emptyInput({ receivables: [r({ pendingAmount: 0 })] }));
    expect(f.scheduledReceivables).toHaveLength(0);
    expect(f.unscheduledReceivables).toHaveLength(0);
  });

  it('umbral configurable por política', () => {
    const input = emptyInput({ receivables: [r({ history: { payments: 5, onTime: 3, avgDaysLate: 4 } })], policy: { minOnTimeRatio: 0.6 } });
    expect(computeForecast(input).scheduledReceivables).toHaveLength(1);
  });
});

describe('Estados y riesgo intradía', () => {
  it('covered cuando ningún escenario falta', () => {
    const f = computeForecast(emptyInput());
    expect(f.status).toBe('covered');
    expect(f.conclusion.headline).toBe('Te alcanza para los próximos 14 días');
    expect(f.actions).toHaveLength(0);
  });

  it('depends cuando solo falta sin el cobro más grande', () => {
    const f = computeForecast(
      emptyInput({
        balance: { stored: 200_000, reconstructed: 200_000, asOf: null },
        receivables: [{ id: 'r1', counterpartyId: 'c1', counterpartyName: 'Hotel X', pendingAmount: 1_000_000, dueDate: '2026-05-26', history: { payments: 6, onTime: 6, avgDaysLate: null } }],
        payables: [{ id: 'p1', counterpartyName: 'Proveedor', pendingAmount: 900_000, dueDate: '2026-05-28', negotiable: true }],
      }),
    );
    expect(f.status).toBe('depends');
    expect(f.conclusion.headline).toBe('Te alcanza si Hotel X paga el martes 26 de mayo');
    expect(f.actions[0]!.kind).toBe('confirm_collection');
    expect(f.actions[0]!.detail).toContain('Si no te lo confirma: pide plazo para Proveedor');
  });

  it('marca riesgo intradía cuando el pago solo se cubre con un cobro del mismo día', () => {
    const f = computeForecast(
      emptyInput({
        receivables: [{ id: 'r1', counterpartyId: 'c1', counterpartyName: 'Clienta', pendingAmount: 600_000, dueDate: '2026-05-26', history: { payments: 4, onTime: 4, avgDaysLate: null } }],
        payables: [{ id: 'p1', counterpartyName: 'Proveedor', pendingAmount: 1_400_000, dueDate: '2026-05-26', negotiable: true }],
      }),
    );
    const day = f.scenarios.expected.days[1]!;
    expect(day.closing).toBe(200_000);
    expect(day.intradayRisk).toBe(true);
  });

  it('una cuenta por pagar vencida es exigible hoy', () => {
    const f = computeForecast(emptyInput({ payables: [{ id: 'p1', counterpartyName: 'Proveedor', pendingAmount: 300_000, dueDate: '2026-05-20', negotiable: true }] }));
    expect(f.scenarios.expected.days[0]!.outflows[0]!.amount).toBe(300_000);
  });
});

describe('Conciliación y movimientos históricos', () => {
  it('un movimiento anterior al saldo de referencia no cambia el guardado pero sí el reconstruido', () => {
    const snap = limpiaYaSnapshot();
    const after = applyPendingOperations(snap, [
      { type: 'movement.create', payload: { movement: { id: 'm_hist', kind: 'income', amount: 120_000, bankId: 'bank_caja', date: '2026-05-20' } } },
    ]);
    const r = computeForecast(buildForecastInput(after));
    expect(r.reference.storedBalance).toBe(1_900_000);
    expect(r.reference.reconstructedBalance).toBe(1_760_000);
    expect(r.reference.alignmentDelta).toBe(140_000);
  });

  it('affectsStoredBalance compara con la fecha local del saldo de referencia', () => {
    expect(affectsStoredBalance('2026-05-25', '2026-05-25T05:00:00.000Z', 'America/Bogota')).toBe(true);
    expect(affectsStoredBalance('2026-05-24', '2026-05-25T05:00:00.000Z', 'America/Bogota')).toBe(false);
  });

  it('un ajuste explícito fija el saldo y la fecha de referencia', () => {
    const after = applyPendingOperations(limpiaYaSnapshot(), [
      { type: 'bank.adjustment', entityId: 'bank_banco', payload: { newBalance: 1_040_000 }, createdAt: '2026-05-25T15:00:00.000Z' },
    ]);
    const r = computeForecast(buildForecastInput(after));
    expect(r.reference.storedBalance).toBe(1_640_000);
    expect(r.reference.alignmentDelta).toBe(0);
  });
});

describe('Pendientes: sin doble conteo', () => {
  const gasto = { type: 'movement.create' as const, payload: { movement: { id: 'm1', kind: 'expense' as const, amount: 45_000, bankId: 'bank_caja', date: '2026-05-25' } } };

  it('aplicar un gasto pendiente lo resta una vez y consume la base de gastos de hoy', () => {
    const r = computeForecast(buildForecastInput(applyPendingOperations(limpiaYaSnapshot(), [gasto])));
    expect(r.reference.storedBalance).toBe(1_855_000);
    expect(r.scenarios.expected.days[0]!.closing).toBe(2_070_000);
  });

  it('si el movimiento ya está confirmado, la operación pendiente no se aplica de nuevo', () => {
    const confirmed: StoreSnapshot = applyPendingOperations(limpiaYaSnapshot(), [gasto]);
    const twice = applyPendingOperations(confirmed, [gasto]);
    expect(twice.banks[0]!.storedLedgerBalance).toBe(confirmed.banks[0]!.storedLedgerBalance);
  });

  it('venta a crédito pendiente crea la cuenta por cobrar y no suma caja', () => {
    const after = applyPendingOperations(limpiaYaSnapshot(), [
      {
        type: 'sale.create',
        payload: { sale: { id: 's1', customerId: 'cli_hotel_brisas', items: [{ quantitiesSold: 40, finalPrice: 52_500 }], payments: [], saleDate: '2026-05-25' } },
      },
    ]);
    expect(after.receivables.find((x) => x.id === 's1')).toMatchObject({ pendingAmount: 2_100_000, creditDueBy: '2026-06-24' });
    expect(buildForecastInput(after).balance.stored).toBe(1_900_000);
  });

  it('venta de contado pendiente suma caja y cuenta como realizado hoy', () => {
    const after = applyPendingOperations(limpiaYaSnapshot(), [
      {
        type: 'sale.create',
        payload: { sale: { id: 's2', customerId: 'cli_x', items: [{ quantitiesSold: 2, finalPrice: 50_000 }], payments: [{ bankId: 'bank_caja', amount: 100_000, paymentDate: '2026-05-25' }], saleDate: '2026-05-25' } },
      },
    ]);
    const input = buildForecastInput(after);
    expect(input.balance.stored).toBe(2_000_000);
    expect(input.realizedToday.cashSales).toBe(100_000);
    expect(computeForecast(input).scenarios.expected.days[0]!.closing).toBe(2_070_000);
  });

  it('pago parcial al proveedor reduce pendiente y caja', () => {
    const after = applyPendingOperations(limpiaYaSnapshot(), [
      { type: 'payable.payment', entityId: 'pay_proveedor', payload: { bankId: 'bank_banco', amount: 1_000_000, paymentDate: '2026-05-25' } },
    ]);
    const r = computeForecast(buildForecastInput(after));
    expect(r.reference.storedBalance).toBe(900_000);
    expect(r.scenarios.expected.days.find((d) => d.date === '2026-05-29')!.closing).toBe(1_510_000);
  });

  it('editar y borrar un movimiento ajustan el saldo por diferencia', () => {
    const created = applyPendingOperations(limpiaYaSnapshot(), [gasto]);
    const edited = applyPendingOperations(created, [{ type: 'movement.update', entityId: 'm1', payload: { changes: { amount: 50_000 } } }]);
    expect(buildForecastInput(edited).balance.stored).toBe(1_850_000);
    const deleted = applyPendingOperations(edited, [{ type: 'movement.delete', entityId: 'm1' }]);
    expect(buildForecastInput(deleted).balance.stored).toBe(1_900_000);
  });

  it('compromiso nuevo, editado y borrado', () => {
    const op = {
      type: 'commitment.create' as const,
      payload: { commitment: { id: 'c_new', direction: 'outflow' as const, concept: 'Servicios', amount: 200_000, schedule: { kind: 'once' as const, date: '2026-05-27' }, negotiable: true } },
    };
    const a = computeForecast(buildForecastInput(applyPendingOperations(limpiaYaSnapshot(), [op])));
    expect(a.scenarios.expected.days.find((d) => d.date === '2026-05-27')!.closing).toBe(2_210_000);
    const b = computeForecast(
      buildForecastInput(applyPendingOperations(limpiaYaSnapshot(), [op, { type: 'commitment.delete', entityId: 'c_new' }])),
    );
    expect(b.scenarios.expected.days.find((d) => d.date === '2026-05-27')!.closing).toBe(2_410_000);
  });
});

describe('Formato', () => {
  it('montos COP legibles', () => {
    expect(formatMoney(1_900_000)).toBe('$ 1.900.000');
    expect(formatMoney(-590_000)).toBe('−$ 590.000');
    expect(formatMoney(0)).toBe('$ 0');
  });
});

describe('Inicio del día local', () => {
  it('Bogotá (UTC−5) y una zona con horario de verano', () => {
    expect(startOfLocalDay('2026-05-25', 'America/Bogota')).toBe('2026-05-25T05:00:00.000Z');
    expect(startOfLocalDay('2026-07-01', 'America/Santiago')).toBe('2026-07-01T04:00:00.000Z');
    expect(startOfLocalDay('2026-01-15', 'America/Santiago')).toBe('2026-01-15T03:00:00.000Z');
  });
});

describe('Reprogramar un cobro', () => {
  it('mover el cobro de Brisas al martes 2 adelanta el faltante al viernes 29', () => {
    const after = applyPendingOperations(limpiaYaSnapshot(), [{ type: 'receivable.reschedule', entityId: 'rcv_brisas', payload: { newDueDate: '2026-06-02' } }]);
    const r = computeForecast(buildForecastInput(after));
    expect(r.scheduledReceivables.find((s) => s.receivableId === 'rcv_brisas')!.date).toBe('2026-06-02');
    expect(r.scenarios.expected.firstShortfall).toMatchObject({ date: '2026-05-29', amount: 590_000 });
  });
});
