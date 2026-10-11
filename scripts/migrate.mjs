import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPool } from '../server/db.js';

export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()), 301001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const directory = new URL('../db/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = (await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name])).rows[0];
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration ${name} changed. Add a new migration instead.`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)', [name,checksum]);
      console.log(`Applied ${name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL in .env first.');
  const pool = createPool(process.env.DATABASE_URL);
  try { await migrate(pool); } finally { await pool.end(); }
}
