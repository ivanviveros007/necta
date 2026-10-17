/** Fecha local de calendario en formato YYYY-MM-DD, sin hora ni zona. */
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

function toUtc(date: LocalDate): Date {
  if (!isLocalDate(date)) throw new Error(`Fecha local inválida: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): LocalDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const value = toUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromUtc(value);
}

/** Días desde `from` hasta `to` (positivo si `to` es posterior). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function weekday(date: LocalDate): number {
  return toUtc(date).getUTCDay();
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function dateRange(start: LocalDate, count: number): LocalDate[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** Fecha local de un instante en una zona IANA (p. ej. America/Bogota). */
export function localDateInZone(instant: Date | string, timeZone: string): LocalDate {
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function weekdayName(date: LocalDate): string {
  return WEEKDAYS[weekday(date)]!;
}

/** «lunes 1 de junio» */
export function formatLongDate(date: LocalDate): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${weekdayName(date)} ${d} de ${MONTHS[m - 1]}`;
}

/** «1 jun» */
export function formatShortDate(date: LocalDate): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]!.slice(0, 3)}`;
}

/** Instante UTC (ISO) del inicio de una fecha local en una zona IANA. */
export function startOfLocalDay(date: LocalDate, timeZone: string): string {
  const target = toUtc(date).getTime();
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const local = localDateTimeAsUtc(new Date(guess), timeZone);
    guess += target - local;
  }
  return new Date(guess).toISOString();
}

function localDateTimeAsUtc(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}
