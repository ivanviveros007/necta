import { Controller, Get } from '@nestjs/common';
import type { ForecastResponse } from '@necta/contracts';
import { Store, StoreScoped, type StoreContext } from '../auth/auth.types';
import { ForecastService } from './forecast.service';

@StoreScoped()
@Controller('v2/forecast')
export class ForecastController {
  constructor(private readonly forecast: ForecastService) {}

  /** Caja a 14 días confirmada por el servidor. No consume créditos de IA. */
  @Get('14d')
  async get(@Store() store: StoreContext): Promise<ForecastResponse> {
    return this.forecast.compute(store);
  }
}
