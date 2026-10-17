import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ApiExceptionFilter } from './common/errors';
import type { AppConfig } from './config/config';

/** Configuración HTTP compartida por main y las pruebas. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.use(cookieParser());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: config.webOrigins,
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-client-platform', 'x-store-id', 'x-csrf-token'],
  });
  app.enableShutdownHooks();
}
