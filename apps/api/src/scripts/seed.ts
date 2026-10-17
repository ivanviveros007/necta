import mongoose from 'mongoose';
import { loadConfig } from '../config/config';
import { DEMO_USER, resetDemo, seedDemo } from './seed-data';

/**
 *   npm run seed -w @necta/api            → borra y vuelve a sembrar el caso de demo
 *   npm run seed -w @necta/api -- --with-device   → además registra un dispositivo push simulado
 *   npm run reset -w @necta/api           → solo borra los datos de demo
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const conn = await mongoose.createConnection(config.mongoUri, { dbName: config.mongoDb }).asPromise();
  try {
    if (process.argv.includes('--reset')) {
      await resetDemo(conn);
      console.log(`Datos de demo borrados de ${config.mongoDb}.`);
    } else {
      await seedDemo(conn, { withDevice: process.argv.includes('--with-device') });
      console.log(`Caso Limpia Ya sembrado en ${config.mongoDb}. Ingreso: ${DEMO_USER.email} / ${DEMO_USER.password}`);
    }
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
