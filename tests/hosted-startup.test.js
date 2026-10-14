import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPool } from '../server/db.js';

test('hosted startup migrates, seeds, serves the built app, and preserves data after restart', { timeout: 60000 }, async () => {
  const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(baseUrl, 'Configure a development TEST_DATABASE_URL before running tests.');
  const schema = `labslot_hosted_${randomUUID().replaceAll('-', '')}`;
  const admin = createPool(baseUrl);
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  const pool = createPool(url.toString());
  let child;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  async function start() {
    child = spawn(process.execPath, ['scripts/start-hosted.mjs'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0',
        JWT_SECRET: 'hosted-test-secret-at-least-32-characters', TRUST_PROXY_HOPS: '1',
        SEED_DEMO: 'true', DEMO_PASSWORD: 'hosted-test-demo-password' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => reject(new Error('Hosted startup timed out.')), 20000);
      child.stdout.on('data', chunk => {
        stdout += chunk;
        const match = stdout.match(/LabSlot API: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Hosted startup exited (${code}): ${stderr}`)); });
    });
  }
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const first = await start();
    const html = await fetch(first);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /\/assets\/.*\.js/);
    assert.equal((await (await fetch(`${first}/api/health`)).json()).database, 'connected');
    for (const role of ['student', 'faculty']) {
      const response = await fetch(`${first}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${role}@labslot.demo`, password: 'hosted-test-demo-password' }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).user.role, role);
    }
    const snapshot = async () => ({
      users: (await pool.query('SELECT id, email, password_hash FROM users ORDER BY email')).rows,
      reservations: (await pool.query('SELECT id, status, start_time FROM reservations ORDER BY id')).rows,
      queue: (await pool.query('SELECT id, status FROM waitlist ORDER BY id')).rows,
      migrations: (await pool.query('SELECT name, checksum FROM schema_migrations ORDER BY name')).rows,
    });
    const before = await snapshot();
    assert.equal(before.users.length, 3);
    assert.equal(before.reservations.length, 10);
    assert.equal(before.queue.length, 1);
    assert.equal(before.migrations.length, 2);
    await stop();
    const second = await start();
    assert.equal((await fetch(`${second}/api/health`)).status, 200);
    assert.deepEqual(await snapshot(), before, 'Restart must not reset or duplicate demo records.');
  } finally {
    await stop();
    await pool.end();
    // Generated test-only schema. The normal application schema is untouched.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
