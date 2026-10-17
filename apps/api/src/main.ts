import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot());
  configureApp(app, config);
  // 0.0.0.0: el teléfono físico llega por la IP de la computadora en la red local.
  await app.listen(config.port, '0.0.0.0');
  Logger.log(
    `API en http://localhost:${config.port} · base ${config.mongoDb} · fecha de negocio ${config.businessDate ?? 'real'} · hoy=${config.todayPolicy}`,
    'Bootstrap',
  );
}

void bootstrap();
