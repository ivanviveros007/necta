import { Global, Module } from '@nestjs/common';
import { ClockService } from '../common/clock.service';
import { APP_CONFIG, loadConfig } from './config';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }, ClockService],
  exports: [APP_CONFIG, ClockService],
})
export class ConfigModule {}
