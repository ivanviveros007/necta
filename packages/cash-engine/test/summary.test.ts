import { describe, expect, it } from 'vitest';
import { buildForecastInput, businessDateCaption, computeForecast, formatMoneyCompact, limpiaYaSnapshot, summarizeForecast, type ForecastInput } from '../src';

const caseSummary = () => summarizeForecast(computeForecast(buildForecastInput(limpiaYaSnapshot())));

describe('Resumen de la home', () => {
  it('una línea de estado con hasta cuándo alcanza y el faltante', () => {
    expect(caseSummary().statusLine).toBe('Alcanza hasta el dom 31 may · faltan $ 590.000 el lun 1 jun');
  });

  it('saldo de hoy y diferencia', () => {
    const s = caseSummary();
    expect(s.balanceToday).toBe(1_900_000);
    expect(s.balanceDelta).toBe(260_000);
  });

  it('totales de la ventana: entra, sale y cobros sin fecha confiable', () => {
    const s = caseSummary();
    // Ventas 260k×8 + 520k×4 = 4.160.000; cobros 2.700.000 · gastos 90k×12 = 1.080.000; pagos 6.900.000
    expect(s.totals).toEqual({ inflow: 6_860_000, outflow: 7_980_000, unscheduled: 2_900_000 });
    expect(1_900_000 + s.totals.inflow - s.totals.outflow).toBe(780_000);
  });

  it('próximos cobros y pagos en orden, con signo, sin la base diaria', () => {
    expect(caseSummary().upcoming.map((u) => [u.date, u.label, u.amount])).toEqual([
      ['2026-05-28', 'Cobro Hotel Brisas', 2_100_000],
      ['2026-05-29', 'Cobro Tienda Doña Fina', 600_000],
      ['2026-05-29', 'Proveedor principal', -4_200_000],
      ['2026-05-30', 'Pago de dos ayudantes', -1_400_000],
      ['2026-06-01', 'Arriendo bodega', -1_300_000],
    ]);
  });

  it('acción principal', () => {
    expect(caseSummary().primaryAction).toEqual({ title: 'Confirma el pago de Hotel Brisas', kind: 'confirm_collection', target: 'Hotel Brisas', amount: 2_100_000, postponeDays: null, sourceId: 'rcv_brisas' });
    expect(caseSummary().minBalance).toEqual({ date: '2026-06-01', amount: -590_000 });
  });

  it('cubierto y faltante hoy', () => {
    const base: ForecastInput = {
      currency: 'COP', timeZone: 'America/Bogota', today: '2026-05-25', todayPolicy: 'fullDay',
      balance: { stored: 100, reconstructed: 100, asOf: null }, realizedToday: { cashSales: 0, cashExpenses: 0 },
      receivables: [], payables: [], commitments: [], baseline: null,
    };
    expect(summarizeForecast(computeForecast(base)).statusLine).toBe('Alcanza las próximas dos semanas');
    const short = computeForecast({ ...base, payables: [{ id: 'p', counterpartyName: 'X', pendingAmount: 500, dueDate: '2026-05-25', negotiable: true }] });
    expect(summarizeForecast(short).statusLine).toBe('Faltan $ 400 hoy');
  });
});

describe('¿Me alcanza para lo que tengo que pagar?', () => {
  it('cobertura de cada pago del caso', () => {
    const s = caseSummary();
    expect(s.payments.map((p) => [p.date, p.label, p.status, p.shortBy, p.dependsOn])).toEqual([
      ['2026-05-29', 'Proveedor principal', 'depends', 0, 'Hotel Brisas'],
      ['2026-05-30', 'Pago de dos ayudantes', 'depends', 0, 'Hotel Brisas'],
      ['2026-06-01', 'Arriendo bodega', 'short', 590_000, null],
    ]);
    expect(s.answer).toBe('Cubres 2 de 3 pagos');
    expect(s.answerDetail).toBe('Faltan $ 590.000 para Arriendo bodega el lun 1 jun. Otros 2 dependen de que Hotel Brisas te pague.');
  });

  it('el faltante de un día se asigna primero al pago más grande', () => {
    const base: ForecastInput = {
      currency: 'COP', timeZone: 'America/Bogota', today: '2026-05-25', todayPolicy: 'fullDay',
      balance: { stored: 1_000, reconstructed: 1_000, asOf: null }, realizedToday: { cashSales: 0, cashExpenses: 0 },
      receivables: [], commitments: [], baseline: null,
      payables: [
        { id: 'a', counterpartyName: 'Grande', pendingAmount: 900, dueDate: '2026-05-26', negotiable: true },
        { id: 'b', counterpartyName: 'Chico', pendingAmount: 300, dueDate: '2026-05-26', negotiable: true },
      ],
    };
    const s = summarizeForecast(computeForecast(base));
    expect(s.payments.map((p) => [p.label, p.status, p.shortBy])).toEqual([
      ['Chico', 'covered', 0],
      ['Grande', 'short', 200],
    ]);
  });

  it('sin pagos cargados lo dice', () => {
    const base: ForecastInput = {
      currency: 'COP', timeZone: 'America/Bogota', today: '2026-05-25', todayPolicy: 'fullDay',
      balance: { stored: 1_000, reconstructed: 1_000, asOf: null }, realizedToday: { cashSales: 0, cashExpenses: 0 },
      receivables: [], payables: [], commitments: [], baseline: null,
    };
    expect(summarizeForecast(computeForecast(base)).answer).toBe('No tienes pagos cargados en estas dos semanas');
  });
});

describe('Formato compacto', () => {
  it('millones, miles y negativos', () => {
    expect(formatMoneyCompact(6_860_000)).toBe('$ 6,86 M');
    expect(formatMoneyCompact(1_900_000)).toBe('$ 1,9 M');
    expect(formatMoneyCompact(590_000)).toBe('$ 590 mil');
    expect(formatMoneyCompact(-2_690_000)).toBe('−$ 2,69 M');
    expect(formatMoneyCompact(400)).toBe('$ 400');
  });
});

describe('Fecha de negocio', () => {
  it('distingue la fecha simulada del caso de la real', () => {
    expect(businessDateCaption('2026-05-25', true)).toBe('Fecha del caso · lun 25 may');
    expect(businessDateCaption('2026-10-17', false)).toBe('Hoy · sáb 17 oct');
  });
});
