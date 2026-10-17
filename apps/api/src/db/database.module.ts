import { Global, Inject, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ConfigModule } from '../config/config.module';
import { MODEL_DEFINITIONS } from './schemas';

/** Verifica al arrancar que MongoDB es un replica set (transacciones) y crea índices. */
@Injectable()
export class DatabaseHealth implements OnModuleInit {
  private readonly logger = new Logger('DatabaseHealth');

  constructor(@Inject(getConnectionToken()) private readonly connection: Connection) {}

  async onModuleInit(): Promise<void> {
    const hello = await this.connection.db!.admin().command({ hello: 1 });
    if (!hello.setName) {
      throw new Error('MongoDB debe correr como replica set (transacciones). Usá `npm run mongo:start`.');
    }
    await Promise.all(Object.values(this.connection.models).map((m) => m.init()));
    this.logger.log(`MongoDB OK · replica set ${hello.setName} · base ${this.connection.db!.databaseName}`);
  }

  async status(): Promise<{ ok: boolean; replicaSet: string | null }> {
    try {
      const hello = await this.connection.db!.admin().command({ hello: 1 });
      return { ok: hello.isWritablePrimary === true, replicaSet: hello.setName ?? null };
    } catch {
      return { ok: false, replicaSet: null };
    }
  }
}

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ uri: config.mongoUri, dbName: config.mongoDb, autoIndex: true }),
    }),
    MongooseModule.forFeature(MODEL_DEFINITIONS),
  ],
  providers: [DatabaseHealth],
  exports: [MongooseModule, DatabaseHealth],
})
export class DatabaseModule {}
