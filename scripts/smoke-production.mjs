// Optional local check of the built Vue bundle served through the real Express
// application. Uses an ephemeral loopback port and makes no data changes.
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { getConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { createApp } from '../server/app.js';

const config = { ...getConfig(), production:true };
const pool = createPool(config.databaseUrl);
const server = createApp(pool, config).listen(0, '127.0.0.1');
try {
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();
  assert.match(html, /LabSlot/);
  const asset = html.match(/src="([^"]+\/assets\/[^\"]+\.js)"/)
    || html.match(/src="(\/assets\/[^\"]+\.js)"/);
  assert.ok(asset, 'Run npm run build first: the page must reference a bundled JavaScript asset.');
  assert.equal((await fetch(`${base}${asset[1]}`)).status, 200);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).database, 'connected');
  console.log('Production smoke check passed: HTML, bundled JavaScript, security policy, and database health.');
} finally {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
}
