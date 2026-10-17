// Benchmark local del motor: cuánto cuesta calcular la caja a 14 días de N tiendas (solo CPU, sin base de datos).
// Uso: npm run build && node scripts/bench.mjs [tiendas]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildForecastInput, computeForecast, limpiaYaSnapshot } = require('../dist/index.js');

const stores = Number(process.argv[2] ?? 10_000);
const snapshot = limpiaYaSnapshot();
for (let i = 0; i < 200; i++) computeForecast(buildForecastInput(snapshot)); // calentamiento
const t0 = process.hrtime.bigint();
for (let i = 0; i < stores; i++) computeForecast(buildForecastInput(snapshot));
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(JSON.stringify({ stores, totalMs: Math.round(ms), msPerStore: +(ms / stores).toFixed(3), node: process.version }));
