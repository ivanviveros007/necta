import { describe, expect, it } from 'vitest';
import {
  applyPendingOperations,
  buildForecastInput,
  CASE_CONSERVATIVE_CLOSINGS,
  CASE_EXPECTED_CLOSINGS,
  computeForecast,
  limpiaYaSnapshot,
} from '../src';

const forecastCase = () => computeForecast(buildForecastInput(limpiaYaSnapshot()));

describe('Caso Limpia Ya · ventana y saldo de referencia', () => {
  it('usa 14 fechas locales del 25 de mayo al 7 de junio', () => {
    const r = forecastCase();
    expect(r.window).toEqual({ start: '2026-05-25', end: '2026-06-07', timeZone: 'America/Bogota', days: 14 });
    expect(r.scenarios.expected.days.map((d) => d.date)).toHaveLength(14);
  });

  it('parte del saldo guardado y muestra la diferencia con el reconstruido sin corregirla', () => {
    const r = forecastCase();
    expect(r.reference.storedBalance).toBe(1_900_000);
    expect(r.reference.reconstructedBalance).toBe(1_640_000);
    expect(r.reference.alignmentDelta).toBe(260_000);
    expect(r.scenarios.expected.days[0]!.opening).toBe(1_900_000);
  });
});

describe('Caso Limpia Ya · 14 días por escenario', () => {
  it('escenario esperado: cierres de los 14 días', () => {
    const r = forecastCase();
    const closings = Object.fromEntries(r.scenarios.expected.days.map((d) => [d.date, d.closing]));
    expect(closings).toEqual(CASE_EXPECTED_CLOSINGS);
  });

  it('escenario conservador: quita el cobro de Hotel Brisas y recalcula los 14 días', () => {
    const r = forecastCase();
    const closings = Object.fromEntries(r.scenarios.conservative.days.map((d) => [d.date, d.closing]));
    expect(closings).toEqual(CASE_CONSERVATIVE_CLOSINGS);
    expect(closings['2026-05-29']).toBe(-590_000);
    expect(closings['2026-06-01']).toBe(-2_690_000);
    expect(r.scenarios.conservative.removedInflow).toEqual({
      sourceId: 'rcv_brisas',
      label: 'Cobro Hotel Brisas',
      amount: 2_100_000,
      date: '2026-05-28',
    });
  });

  it('primer faltante por escenario con su causa y estado global short', () => {
    const r = forecastCase();
    expect(r.status).toBe('short');
    expect(r.scenarios.expected.firstShortfall).toEqual({
      date: '2026-06-01',
      amount: 590_000,
      cause: { label: 'Arriendo bodega', amount: 1_300_000 },
    });
    expect(r.scenarios.conservative.firstShortfall).toEqual({
      date: '2026-05-29',
      amount: 590_000,
      cause: { label: 'Proveedor principal', amount: 4_200_000 },
    });
  });

  it('detalle diario: el viernes 29 entra Doña Fina y sale el proveedor', () => {
    const day = forecastCase().scenarios.expected.days.find((d) => d.date === '2026-05-29')!;
    expect(day.inflows.map((f) => [f.label, f.amount])).toEqual([
      ['Ventas de contado habituales', 520_000],
      ['Cobro Tienda Doña Fina', 600_000],
    ]);
    expect(day.outflows.map((f) => [f.label, f.amount])).toEqual([
      ['Gastos de contado habituales', 90_000],
      ['Proveedor principal', 4_200_000],
    ]);
    expect(day.opening).toBe(4_680_000);
    expect(day.intradayRisk).toBe(false);
  });

  it('incluye ayudantes el 30, arriendo el 1 y deja la cuota del 10 fuera de la ventana', () => {
    const days = forecastCase().scenarios.expected.days;
    const labels = (date: string) => days.find((d) => d.date === date)!.outflows.map((f) => f.label);
    expect(labels('2026-05-30')).toContain('Pago de dos ayudantes');
    expect(labels('2026-06-01')).toContain('Arriendo bodega');
    expect(days.flatMap((d) => d.outflows).some((f) => f.label === 'Cuota préstamo')).toBe(false);
  });

  it('domingo sin ventas ni gastos', () => {
    const sunday = forecastCase().scenarios.expected.days.find((d) => d.date === '2026-05-31')!;
    expect(sunday.inflows).toHaveLength(0);
    expect(sunday.outflows).toHaveLength(0);
  });
});

describe('Caso Limpia Ya · cobros', () => {
  it('programa solo a Brisas (28) y Doña Fina (29) con la regla y datos usados', () => {
    const r = forecastCase();
    expect(r.scheduledReceivables.map((s) => [s.counterpartyName, s.date, s.amount])).toEqual([
      ['Hotel Brisas', '2026-05-28', 2_100_000],
      ['Tienda Doña Fina', '2026-05-29', 600_000],
    ]);
    expect(r.scheduledReceivables[0]!.basis).toContain('6 de 6 a tiempo');
  });

  it('deja visibles los cobros sin fecha confiable con su motivo, sin inventar fechas', () => {
    const r = forecastCase();
    const byName = Object.fromEntries(r.unscheduledReceivables.map((u) => [u.counterpartyName, u]));
    expect(byName['Minimercado Sol']).toMatchObject({ reason: 'overdue', daysOverdue: 20, pendingAmount: 1_200_000 });
    expect(byName['Tienda La Esquina']).toMatchObject({ reason: 'late_payer', pendingAmount: 850_000 });
    expect(byName['Tienda La Esquina']!.basis).toContain('2 de 5 a tiempo, en promedio 12 días tarde');
    expect(byName['Otras 9 tiendas']).toMatchObject({
      reason: 'no_due_date',
      dueDate: null,
      dueHint: 'próximas dos semanas',
      aggregated: true,
      pendingAmount: 850_000,
    });
  });
});

describe('Caso Limpia Ya · dependencias y acciones', () => {
  it('el pago al proveedor depende de Hotel Brisas', () => {
    const deps = forecastCase().dependencies;
    expect(deps[0]).toMatchObject({
      receivableId: 'rcv_brisas',
      affectedDate: '2026-05-29',
      affectedCause: 'Proveedor principal',
      shortfallWithout: 590_000,
    });
  });

  it('primera acción: confirmar Brisas; luego cobrar a Sol antes que a La Esquina; aplazar arriendo 4 días', () => {
    const actions = forecastCase().actions;
    expect(actions[0]).toMatchObject({ kind: 'confirm_collection', sourceId: 'rcv_brisas', riskDate: '2026-05-29' });
    expect(actions[0]!.title).toBe('Confirma el pago de Hotel Brisas');

    const collects = actions.filter((a) => a.kind === 'collect');
    expect(collects.map((a) => a.sourceId)).toEqual(['rcv_sol', 'rcv_esquina']);
    expect(collects[0]!.impact.resolves).toBe(true);
    expect(collects[0]!.detail).toContain('desde hace 20 días');
    expect(actions.some((a) => a.sourceId === 'rcv_otras')).toBe(false);

    const rent = actions.find((a) => a.kind === 'postpone' && a.sourceId === 'cmt_arriendo')!;
    expect(rent.postponeDays).toBe(4);
    expect(rent.impact.resolves).toBe(true);
    expect(actions.some((a) => a.kind === 'postpone' && a.sourceId === 'cmt_ayudantes')).toBe(false);
  });

  it('las acciones se ordenan por la fecha del riesgo que mitigan', () => {
    const dates = forecastCase().actions.map((a) => a.riskDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it('conclusión en español con el faltante y la dependencia', () => {
    const { conclusion } = forecastCase();
    expect(conclusion.headline).toBe('Te faltan $ 590.000 el lunes 1 de junio');
    expect(conclusion.detail).toContain('Hotel Brisas');
    expect(conclusion.detail).toContain('viernes 29 de mayo');
  });

  it('supuestos visibles y sin porcentajes de confianza', () => {
    const r = forecastCase();
    const texts = r.assumptions.map((a) => a.text).join(' ');
    expect(texts).toContain('lun–jue $ 260.000, vie–sáb $ 520.000, dom sin movimiento');
    expect(texts).toContain('Arriendo bodega: $ 1.300.000 el día 1 de cada mes (cargado por ti)');
    expect(texts).toContain('diferencia de $ 260.000');
    expect(JSON.stringify(r)).not.toMatch(/confianza|probabilidad/i);
  });

  it('es determinista', () => {
    expect(forecastCase()).toEqual(forecastCase());
  });
});

describe('Pendientes locales sobre el caso', () => {
  it('un cobro parcial pendiente sube el saldo y baja el cobro programado una sola vez', () => {
    const base = limpiaYaSnapshot();
    const withPending = applyPendingOperations(base, [
      { type: 'receivable.payment', entityId: 'rcv_brisas', payload: { bankId: 'bank_caja', amount: 500_000, paymentDate: '2026-05-25' } },
    ]);
    const r = computeForecast(buildForecastInput(withPending));
    expect(r.reference.storedBalance).toBe(2_400_000);
    expect(r.scheduledReceivables.find((s) => s.receivableId === 'rcv_brisas')!.amount).toBe(1_600_000);
    // El cierre del 28 no cambia: lo cobrado antes reemplaza lo previsto.
    expect(r.scenarios.expected.days.find((d) => d.date === '2026-05-28')!.closing).toBe(4_680_000);
    // El estado confirmado no se modifica.
    expect(base.banks[0]!.storedLedgerBalance).toBe(600_000);
  });
});
