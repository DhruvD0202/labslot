import { getConfig } from './config.js';
import { createPool } from './db.js';
import { createApp } from './app.js';

const config = getConfig();
const pool = createPool(config.databaseUrl);
await pool.query('SELECT 1');
const server = createApp(pool, config).listen(config.port, config.host, () => {
  console.log(`LabSlot API: http://${config.host}:${config.port}`);
});
async function stop() {
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
