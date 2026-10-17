import type { StoreSnapshot } from '../snapshot';

/**
 * Caso «Limpia Ya» del enunciado (datos ficticios). Corte al inicio del lunes 25 de mayo de 2026,
 * America/Bogota. Solo contiene lo que dice el caso:
 * - Saldo guardado 1.900.000 (caja 600.000 + banco 1.300.000); reconstruido 1.640.000. El reparto
 *   entre bolsillos replica el ejemplo del anexo (banco: 1.300.000 vs 1.040.000).
 * - Otras 9 tiendas: un saldo agregado sin fecha individual (no se inventan fechas).
 * - Historial de puntualidad tal como lo da la tabla (6 meses).
 */
export const CASE_BUSINESS_DATE = '2026-05-25';
export const CASE_BALANCE_AS_OF = '2026-05-25T05:00:00.000Z';

export function limpiaYaSnapshot(): StoreSnapshot {
  return {
    currency: 'COP',
    timeZone: 'America/Bogota',
    businessDate: CASE_BUSINESS_DATE,
    todayPolicy: 'fullDay',
    banks: [
      { id: 'bank_caja', name: 'Caja', storedLedgerBalance: 600_000, reconstructedBalance: 600_000, balanceAsOf: CASE_BALANCE_AS_OF },
      { id: 'bank_banco', name: 'Banco', storedLedgerBalance: 1_300_000, reconstructedBalance: 1_040_000, balanceAsOf: CASE_BALANCE_AS_OF },
    ],
    counterparties: [
      { id: 'cli_hotel_brisas', name: 'Hotel Brisas', history: { payments: 6, onTime: 6, avgDaysLate: null } },
      { id: 'cli_minimercado_sol', name: 'Minimercado Sol', history: { payments: 4, onTime: 1, avgDaysLate: 18 } },
      { id: 'cli_tienda_la_esquina', name: 'Tienda La Esquina', history: { payments: 5, onTime: 2, avgDaysLate: 12 } },
      { id: 'cli_tienda_dona_fina', name: 'Tienda Doña Fina', history: { payments: 4, onTime: 4, avgDaysLate: null } },
      { id: 'cli_otras_9_tiendas', name: 'Otras 9 tiendas', aggregated: true, history: { payments: 31, onTime: 22, avgDaysLate: null } },
    ],
    receivables: [
      { id: 'rcv_brisas', counterpartyId: 'cli_hotel_brisas', counterpartyName: 'Hotel Brisas', totalAmount: 2_100_000, pendingAmount: 2_100_000, creditDueBy: '2026-05-28' },
      { id: 'rcv_sol', counterpartyId: 'cli_minimercado_sol', counterpartyName: 'Minimercado Sol', totalAmount: 1_200_000, pendingAmount: 1_200_000, creditDueBy: '2026-05-05' },
      { id: 'rcv_esquina', counterpartyId: 'cli_tienda_la_esquina', counterpartyName: 'Tienda La Esquina', totalAmount: 850_000, pendingAmount: 850_000, creditDueBy: '2026-05-26' },
      { id: 'rcv_fina', counterpartyId: 'cli_tienda_dona_fina', counterpartyName: 'Tienda Doña Fina', totalAmount: 600_000, pendingAmount: 600_000, creditDueBy: '2026-05-29' },
      { id: 'rcv_otras', counterpartyId: 'cli_otras_9_tiendas', counterpartyName: 'Otras 9 tiendas', totalAmount: 850_000, pendingAmount: 850_000, creditDueBy: null, dueHint: 'próximas dos semanas' },
    ],
    payables: [
      { id: 'pay_proveedor', counterpartyName: 'Proveedor principal', totalAmount: 4_200_000, pendingAmount: 4_200_000, creditDueBy: '2026-05-29', negotiable: true },
    ],
    commitments: [
      { id: 'cmt_ayudantes', direction: 'outflow', concept: 'Pago de dos ayudantes', amount: 1_400_000, schedule: { kind: 'monthly', daysOfMonth: [15, 30], startDate: '2026-01-01' }, negotiable: false },
      { id: 'cmt_arriendo', direction: 'outflow', concept: 'Arriendo bodega', amount: 1_300_000, schedule: { kind: 'monthly', daysOfMonth: [1], startDate: '2026-01-01' }, negotiable: true },
      { id: 'cmt_prestamo', direction: 'outflow', concept: 'Cuota préstamo', amount: 650_000, schedule: { kind: 'monthly', daysOfMonth: [10], startDate: '2026-01-01' }, negotiable: false },
    ],
    movements: [],
    sales: [],
    baseline: {
      weekdaySales: [0, 260_000, 260_000, 260_000, 260_000, 520_000, 520_000],
      weekdayExpenses: [0, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000],
    },
  };
}

/** Cierres esperados del caso, verificados a mano en PROPUESTA.md y design.md. */
export const CASE_EXPECTED_CLOSINGS: Record<string, number> = {
  '2026-05-25': 2_070_000,
  '2026-05-26': 2_240_000,
  '2026-05-27': 2_410_000,
  '2026-05-28': 4_680_000,
  '2026-05-29': 1_510_000,
  '2026-05-30': 540_000,
  '2026-05-31': 540_000,
  '2026-06-01': -590_000,
  '2026-06-02': -420_000,
  '2026-06-03': -250_000,
  '2026-06-04': -80_000,
  '2026-06-05': 350_000,
  '2026-06-06': 780_000,
  '2026-06-07': 780_000,
};

export const CASE_CONSERVATIVE_CLOSINGS: Record<string, number> = Object.fromEntries(
  Object.entries(CASE_EXPECTED_CLOSINGS).map(([date, value]) => [date, date >= '2026-05-28' ? value - 2_100_000 : value]),
);
