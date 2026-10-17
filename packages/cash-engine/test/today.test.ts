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
    // Sin hora de registro: orden estable por clave (mismo resultado en web y móvil).
    expect(t.items.map((i) => [i.label, i.amount])).toEqual([
      ['Venta de contados', 100_000],
      ['Cobro Tienda Doña Fina', 600_000],
      ['Venta de contado', 50_000],
    ]);
    expect(t.items[0]!.movementId).toBe('m1');
    expect(t.items[1]!.movementId).toBeUndefined();
    expect(t.sales).toEqual({ done: 150_000, expected: 260_000 });
    expect(t.expenses).toEqual({ done: 0, expected: 90_000 });
  });

  it('suma los movimientos pendientes del dispositivo', () => {
    const t = todayActivity(records, [{ key: 'o:mv:x', label: 'Bolsas', amount: -45_000, state: 'pending', at: '2026-10-17T17:00:00Z' }]);
    expect(t.items[0]).toMatchObject({ label: 'Bolsas', state: 'pending' });
    expect(t.expenses.done).toBe(45_000);
  });
});

describe('Pagos anulados', () => {
  it('no aparecen en «Hoy» y los vigentes son anulables', () => {
    const t = todayActivity({
      businessDate: '2026-05-25',
      movements: [],
      sales: [],
      receivables: [
        {
          id: 'rcv_fina',
          counterpartyName: 'Tienda Doña Fina',
          payments: [
            { clientMutationId: 'c1', amount: 600_000, paymentDate: '2026-05-25', bankId: 'bank_caja', voidedAt: '2026-05-25T15:00:00Z' },
            { clientMutationId: 'c2', amount: 500_000, paymentDate: '2026-05-25', bankId: 'bank_caja' },
          ],
        },
      ],
      payables: [],
      baseline: null,
    });
    expect(t.items).toHaveLength(1);
    expect(t.items[0]!.payment).toEqual({ kind: 'receivable', debtId: 'rcv_fina', clientMutationId: 'c2', amount: 500_000, bankId: 'bank_caja', paymentDate: '2026-05-25' });
  });
});

describe('Orden de «Hoy»', () => {
  it('más reciente primero, igual sin importar el orden de entrada; sin hora al final', () => {
    const base = {
      businessDate: '2026-05-25',
      sales: [],
      payables: [],
      baseline: null,
      receivables: [{ id: 'r', counterpartyName: 'Fina', payments: [{ clientMutationId: 'p0', amount: 1, paymentDate: '2026-05-25' }] }],
    };
    const movements = [
      { id: 'a', kind: 'expense' as const, amount: 1, date: '2026-05-25', createdAt: '2026-10-17T15:00:00Z' },
      { id: 'b', kind: 'expense' as const, amount: 1, date: '2026-05-25', createdAt: '2026-10-17T16:00:00Z' },
    ];
    const one = todayActivity({ ...base, movements }, [{ key: 'o:mv:x', label: 'pend', amount: -1, state: 'pending', at: '2026-10-17T17:00:00Z' }]);
    const two = todayActivity({ ...base, movements: [...movements].reverse() }, [{ key: 'o:mv:x', label: 'pend', amount: -1, state: 'pending', at: '2026-10-17T17:00:00Z' }]);
    expect(one.items.map((i) => i.key)).toEqual(['o:mv:x', 'm:b', 'm:a', 'rp:p0']);
    expect(two.items.map((i) => i.key)).toEqual(one.items.map((i) => i.key));
  });
});
