import { businessDateCaption } from '@necta/cash-engine';
import { createContext, useContext, type ReactNode } from 'react';

interface BusinessDate {
  date: string;
  simulated: boolean;
  timeZone: string;
}

const Ctx = createContext<BusinessDate | null>(null);

export function BusinessDateProvider({ date, simulated, timeZone, children }: BusinessDate & { children: ReactNode }) {
  return <Ctx.Provider value={{ date, simulated, timeZone }}>{children}</Ctx.Provider>;
}

/** Zona horaria de la tienda (para comparar fechas locales). */
export function useStoreTimeZone(): string {
  return useContext(Ctx)?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** «Hoy · …» o «Fecha del caso · …» si la API trabaja con una fecha simulada. */
export function useDateCaption(date: string): string {
  const ctx = useContext(Ctx);
  return businessDateCaption(date, ctx?.simulated ?? false);
}
