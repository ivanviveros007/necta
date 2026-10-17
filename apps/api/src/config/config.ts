import { isLocalDate } from '@necta/cash-engine';

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  mongoUri: string;
  mongoDb: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  webOrigins: string[];
  cookieSecure: boolean;
  /** Fecha de negocio fija para reproducir el caso (YYYY-MM-DD). Vacía en producción. */
  businessDate: string | null;
  todayPolicy: 'fullDay' | 'none';
  reviewBatchMs: number;
  reviewTickMs: number;
  deliveryTickMs: number;
  dailyReviewHour: number;
  schedulerEnabled: boolean;
  devEndpoints: boolean;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV as AppConfig['env']) ?? 'development';
  const jwtSecret = env.JWT_SECRET ?? '';
  if (nodeEnv === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
  }
  const businessDate = env.BUSINESS_DATE?.trim() || null;
  if (businessDate && !isLocalDate(businessDate)) throw new Error('BUSINESS_DATE debe ser YYYY-MM-DD');
  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 3000),
    mongoUri: env.MONGO_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0',
    mongoDb: env.MONGO_DB ?? 'necta_demo',
    jwtSecret: jwtSecret || 'dev-only-secret-change-me-dev-only-secret',
    jwtTtlSeconds: Number(env.JWT_TTL_SECONDS ?? 8 * 3600),
    webOrigins: (env.WEB_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    cookieSecure: bool(env.COOKIE_SECURE, nodeEnv === 'production'),
    businessDate,
    todayPolicy: env.TODAY_POLICY === 'fullDay' ? 'fullDay' : 'none',
    reviewBatchMs: Number(env.REVIEW_BATCH_MS ?? 30_000),
    reviewTickMs: Number(env.REVIEW_TICK_MS ?? 5_000),
    deliveryTickMs: Number(env.DELIVERY_TICK_MS ?? 3_000),
    dailyReviewHour: Number(env.DAILY_REVIEW_HOUR ?? 7),
    schedulerEnabled: bool(env.SCHEDULER_ENABLED, nodeEnv !== 'test'),
    devEndpoints: bool(env.DEV_ENDPOINTS, nodeEnv !== 'production'),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
