import { describe, expect, it } from 'vitest';
import { todayActivity } from '../src';

describe('Actividad de hoy', () => {
  const records = {
    businessDate: '2026-05-25',
    movements: [
      { id: 'm1', kind: 'income' as const, amount: 100_000, date: '2026-05-25', description: 'Venta de contados' },
      { id: 'm2', kind: 'expense' as const, amount: 30_000, date: '2026-05-24' },
      { id: 'm3', kind: 'expense' as const, amount: 20_000, date: '2026-05-25', deletedAt: 'x' },
    ],
    sales: [{ id: 's1', saleDate: '2026-05-25', paidAmount: 50_000 }],
    receivables: [{ counterpartyName: 'Tienda Doña Fina', payments: [{ clientMutationId: 'c1', amount: 600_000, paymentDate: '2026-05-25' }] }],
    payables: [{ counterpartyName: 'Proveedor', payments: [{ clientMutationId: 'c2', amount: 10_000, paymentDate: '2026-05-20' }] }],
    baseline: { weekdaySales: [0, 260_000, 0, 0, 0, 0, 0], weekdayExpenses: [0, 90_000, 0, 0, 0, 0, 0] },
  };

  it('lista lo de hoy (sin borrados ni otros días) y el avance contra lo habitual', () => {
    const t = todayActivity(records);
    expect(t.items.map((i) => [i.label, i.amount])).toEqual([
      ['Venta de contados', 100_000],
      ['Venta de contado', 50_000],
      ['Cobro Tienda Doña Fina', 600_000],
    ]);
    expect(t.items[0]!.movementId).toBe('m1');
    expect(t.items[2]!.movementId).toBeUndefined();
    expect(t.sales).toEqual({ done: 150_000, expected: 260_000 });
    expect(t.expenses).toEqual({ done: 0, expected: 90_000 });
  });

  it('suma los movimientos pendientes del dispositivo', () => {
    const t = todayActivity(records, [{ key: 'o:mv:x', label: 'Bolsas', amount: -45_000, state: 'pending' }]);
    expect(t.items.at(-1)).toMatchObject({ label: 'Bolsas', state: 'pending' });
    expect(t.expenses.done).toBe(45_000);
  });
});
