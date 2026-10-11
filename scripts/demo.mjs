import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import EmbeddedPostgres from 'embedded-postgres';
import { createPool } from '../server/db.js';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { startDev } from './dev.mjs';

mkdirSync('.local', { recursive:true });
const settingsPath = '.local/postgres.json';
let settings;
if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
else {
  settings = { port:55432, user:'labslot', password:randomBytes(24).toString('hex') };
  writeFileSync(settingsPath, JSON.stringify(settings), { mode:0o600 });
}
const localUrl = `postgresql://${settings.user}:${settings.password}@127.0.0.1:${settings.port}/labslot`;
if (!existsSync('.env')) writeFileSync('.env', [
  `DATABASE_URL=${localUrl}`, `JWT_SECRET=${randomBytes(48).toString('hex')}`,
  'PORT=3001','HOST=127.0.0.1','NODE_ENV=development','DEMO_PASSWORD=LabSlot-demo-2026!','VITE_DEMO_MODE=true','',
].join('\n'), { mode:0o600 });
dotenv.config({ override:true, quiet:true });
if (process.env.DATABASE_URL !== localUrl) {
  throw new Error('Your .env targets another database. Use npm run db:migrate, npm run db:seed and npm run dev; demo does not replace your settings.');
}
const databaseDir = resolve('.local/postgres');
const postgres = new EmbeddedPostgres({
  databaseDir, ...settings, persistent:true, authMethod:'scram-sha-256',
  initdbFlags:['--encoding=UTF8','--locale=C'],
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c','timezone=Asia/Kolkata'],
  onLog: () => {}, onError: message => { if (/FATAL|ERROR/.test(String(message))) console.error(String(message)); },
});
if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await postgres.initialise();
await postgres.start();
const admin = createPool(localUrl.replace(/\/labslot$/, '/postgres'));
try {
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='labslot'")).rowCount) await admin.query('CREATE DATABASE labslot');
} finally { await admin.end(); }
const pool = createPool(localUrl);
let stopDev;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  stopDev?.();
  await postgres.stop();
}
process.on('SIGINT', () => stop().then(() => process.exit(0)));
process.on('SIGTERM', () => stop().then(() => process.exit(0)));
try {
  await migrate(pool);
  await seed(pool);
  await pool.end();
  console.log('PostgreSQL is running locally on port 55432. Opening LabSlot at http://127.0.0.1:5173');
  stopDev = startDev();
} catch (error) {
  await pool.end();
  await stop();
  throw error;
}
