import { Inject, Injectable } from '@nestjs/common';
import { localDateInZone, startOfLocalDay, type LocalDate } from '@necta/cash-engine';
import { APP_CONFIG, type AppConfig } from '../config/config';

/** Reloj de negocio: permite fijar la fecha del caso (BUSINESS_DATE) sin alterar el reloj real. */
@Injectable()
export class ClockService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  now(): Date {
    return new Date();
  }

  businessDate(timeZone: string): LocalDate {
    return this.config.businessDate ?? localDateInZone(this.now(), timeZone);
  }

  /** La fecha de negocio está fijada por configuración (demo del caso), no es la real. */
  isSimulated(): boolean {
    return this.config.businessDate !== null;
  }

  todayPolicy(): 'fullDay' | 'none' {
    return this.config.todayPolicy;
  }

  /** Corte del cálculo: inicio del día (fullDay) o instante actual (none). */
  cutoff(timeZone: string): string {
    return this.todayPolicy() === 'fullDay'
      ? startOfLocalDay(this.businessDate(timeZone), timeZone)
      : this.now().toISOString();
  }
}
