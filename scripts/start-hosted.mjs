// Free Render services have no pre-deploy command. Prepare the database before
// accepting traffic. Migrations use their existing checksum/advisory-lock logic.
import { access } from 'node:fs/promises';
import { getConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';

await access(new URL('../dist/index.html', import.meta.url));
const config = getConfig();
if (!['true', 'false', undefined].includes(process.env.SEED_DEMO)) {
  throw new Error('SEED_DEMO must be true or false.');
}
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool);
  if (process.env.SEED_DEMO === 'true') await seed(pool);
} finally {
  await pool.end();
}
// The normal server owns its connection pool and graceful shutdown handlers.
await import('../server/index.js');
