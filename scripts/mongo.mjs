#!/usr/bin/env node
/**
 * MongoDB local para la demo: replica set de un nodo (necesario para transacciones).
 * Usa su propio directorio (.data/mongo) y puerto (27018): no toca instancias ni bases existentes.
 *
 *   node scripts/mongo.mjs start | stop | status
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/api/package.json'));
const { MongoClient } = require('mongodb');

const PORT = Number(process.env.MONGO_LOCAL_PORT ?? 27018);
const REPL_SET = 'rs0';
const dataDir = join(root, '.data', 'mongo');
const logPath = join(root, '.data', 'mongod.log');
const pidPath = join(root, '.data', 'mongod.pid');
const uri = `mongodb://127.0.0.1:${PORT}/?directConnection=true`;

async function client() {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
  await c.connect();
  return c;
}

async function health() {
  try {
    const c = await client();
    const hello = await c.db('admin').command({ hello: 1 });
    await c.close();
    return { up: true, primary: hello.isWritablePrimary === true, setName: hello.setName ?? null };
  } catch {
    return { up: false, primary: false, setName: null };
  }
}

async function start() {
  const h = await health();
  if (h.up && h.primary) {
    console.log(`MongoDB ya está listo en ${uri} (replica set ${h.setName}).`);
    return;
  }
  if (!h.up) {
    const which = spawnSync('which', ['mongod'], { encoding: 'utf8' });
    if (which.status !== 0) {
      console.error('No se encontró mongod. Instalá MongoDB Community 7+ (brew install mongodb-community@7.0).');
      process.exit(1);
    }
    mkdirSync(dataDir, { recursive: true });
    const r = spawnSync(
      'mongod',
      ['--replSet', REPL_SET, '--port', String(PORT), '--bind_ip', '127.0.0.1', '--dbpath', dataDir,
        '--logpath', logPath, '--pidfilepath', pidPath, '--fork'],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const c = await client();
  try {
    await c.db('admin').command({ replSetGetStatus: 1 });
  } catch {
    await c.db('admin').command({
      replSetInitiate: { _id: REPL_SET, members: [{ _id: 0, host: `127.0.0.1:${PORT}` }] },
    });
  }
  await c.close();
  for (let i = 0; i < 30; i++) {
    const s = await health();
    if (s.primary) {
      console.log(`MongoDB listo en ${uri} (replica set ${s.setName}).`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error('El replica set no llegó a PRIMARY. Revisá .data/mongod.log');
  process.exit(1);
}

async function stop() {
  if (!existsSync(pidPath)) {
    console.log('No hay mongod de la demo corriendo (sin pidfile).');
    return;
  }
  const pid = Number(readFileSync(pidPath, 'utf8').trim());
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`mongod de la demo detenido (pid ${pid}).`);
  } catch {
    console.log('El proceso ya no existe.');
  }
}

const cmd = process.argv[2] ?? 'status';
if (cmd === 'start') await start();
else if (cmd === 'stop') await stop();
else {
  const h = await health();
  console.log(JSON.stringify({ uri, ...h }));
  process.exit(h.primary ? 0 : 1);
}
