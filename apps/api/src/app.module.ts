import { Controller, DynamicModule, Get, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SimulatedEmailAdapter, SimulatedPushAdapter, SimulationState, EMAIL_ADAPTER, PUSH_ADAPTER } from './alerts/adapters';
import { AlertsController, DevController, PushController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { DeliveryService } from './alerts/delivery.service';
import { ReviewService } from './alerts/review.service';
import { AuthModule } from './auth/auth.module';
import { Public } from './auth/auth.types';
import { loadConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { DatabaseHealth, DatabaseModule } from './db/database.module';
import { StoreEvents } from './events/store-events';
import { ForecastController } from './forecast/forecast.controller';
import { ForecastService } from './forecast/forecast.service';
import { OperationsService } from './operations/operations.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RecordsController } from './records/records.controller';
import { SyncController } from './sync/sync.controller';
import { SyncService } from './sync/sync.service';

@Controller()
class HealthController {
  constructor(private readonly db: DatabaseHealth) {}

  @Public()
  @Get('health')
  async health() {
    const mongo = await this.db.status();
    return { ok: mongo.ok, mongo };
  }
}

@Module({})
export class AppModule {
  static forRoot(options: { scheduler?: boolean; devEndpoints?: boolean } = {}): DynamicModule {
    const config = loadConfig();
    const scheduler = options.scheduler ?? config.schedulerEnabled;
    const devEndpoints = options.devEndpoints ?? config.devEndpoints;
    return {
      module: AppModule,
      imports: [ConfigModule, DatabaseModule, AuthModule, ...(scheduler ? [ScheduleModule.forRoot()] : [])],
      controllers: [
        HealthController,
        RecordsController,
        SyncController,
        ForecastController,
        AlertsController,
        PushController,
        ...(devEndpoints ? [DevController] : []),
      ],
      providers: [
        StoreEvents,
        OperationsService,
        SyncService,
        ForecastService,
        RealtimeGateway,
        AlertsService,
        DeliveryService,
        ReviewService,
        SimulationState,
        { provide: PUSH_ADAPTER, useClass: SimulatedPushAdapter },
        { provide: EMAIL_ADAPTER, useClass: SimulatedEmailAdapter },
      ],
    };
  }
}
