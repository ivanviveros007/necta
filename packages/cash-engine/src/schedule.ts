import { daysInMonth, isLocalDate, type LocalDate } from './dates';
import type { Schedule } from './types';

/**
 * Fechas de un calendario dentro de [start, end], inclusive.
 * Un día del mes inexistente (30 en febrero) cae en el último día del mes.
 */
export function occurrencesBetween(schedule: Schedule, start: LocalDate, end: LocalDate): LocalDate[] {
  if (schedule.kind === 'once') {
    return schedule.date >= start && schedule.date <= end ? [schedule.date] : [];
  }
  const from = schedule.startDate > start ? schedule.startDate : start;
  const until = schedule.endDate && schedule.endDate < end ? schedule.endDate : end;
  if (from > until) return [];

  const result = new Set<LocalDate>();
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(until.slice(0, 4));
  const lastMonth = Number(until.slice(5, 7));
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const maxDay = daysInMonth(year, month);
    for (const day of schedule.daysOfMonth) {
      const effective = Math.min(day, maxDay);
      const date = `${year}-${String(month).padStart(2, '0')}-${String(effective).padStart(2, '0')}`;
      if (date >= from && date <= until) result.add(date);
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return [...result].sort();
}

export function validateSchedule(schedule: Schedule): string | null {
  if (schedule.kind === 'once') return isLocalDate(schedule.date) ? null : 'date';
  if (!isLocalDate(schedule.startDate)) return 'startDate';
  if (schedule.endDate && !isLocalDate(schedule.endDate)) return 'endDate';
  if (schedule.daysOfMonth.length === 0) return 'daysOfMonth';
  if (schedule.daysOfMonth.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) return 'daysOfMonth';
  return null;
}

export function describeSchedule(schedule: Schedule): string {
  if (schedule.kind === 'once') return `el ${schedule.date}`;
  const days = [...schedule.daysOfMonth].sort((a, b) => a - b);
  if (days.length === 1) return `el día ${days[0]} de cada mes`;
  return `los días ${days.slice(0, -1).join(', ')} y ${days[days.length - 1]} de cada mes`;
}
