import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createPool, transaction } from '../server/db.js';
import { migrate } from '../scripts/migrate.mjs';
import { createApp } from '../server/app.js';
import { signToken } from '../server/middleware/auth.js';

export const fixedNow = '2035-01-01T08:00:00';
export async function fixture() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Start npm run demo in another terminal, or set TEST_DATABASE_URL to a development database.');
  const schema = `labslot_test_${randomUUID().replaceAll('-','')}`;
  const admin = createPool(url);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = createPool(url, { max:32, options:`-c search_path=${schema},public` });
  try {
    await migrate(pool);
    // Control only the clock, inside this disposable schema. Production SQL and
    // all constraints/triggers otherwise run unchanged against real PostgreSQL.
    await pool.query(`CREATE OR REPLACE FUNCTION campus_now() RETURNS timestamp LANGUAGE sql VOLATILE
      AS $$ SELECT timestamp '${fixedNow}' $$`);
    const hash = await bcrypt.hash('test-password-123', 4);
    const users = {};
    for (const [key,role] of [['student','student'],['student2','student'],['faculty','faculty'],['faculty2','faculty']]) {
      users[key] = (await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING *',
        [key,`${key}@example.test`,hash,role])).rows[0];
    }
    const config = { jwtSecret:'test-only-jwt-secret-at-least-32-characters', production:false };
    const app = createApp(pool, config);
    return {
      pool, app, users, schema,
      token: key => signToken(users[key], config.jwtSecret),
      asset: async (status = 'active') => (await pool.query(`INSERT INTO equipment(asset_tag,name,type,location,operational_status)
        VALUES ($1,'Test microscope','Microscopy','Test lab',$2) RETURNING *`, [randomUUID(),status])).rows[0],
      at: async value => pool.query(`CREATE OR REPLACE FUNCTION campus_now() RETURNS timestamp LANGUAGE sql VOLATILE AS $$ SELECT timestamp '${value.replaceAll("'", "''")}' $$`),
      close: async () => {
        await pool.end();
        // Name is generated here, never user input. Only this test-owned schema
        // is removed; the application's tables and demo data are never touched.
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.end();
      },
    };
  } catch (error) {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw error;
  }
}

export function slot(asset, start = '2035-01-05T09:00', end = '2035-01-05T10:00', extra = {}) {
  return { equipment_id:asset.id, start_time:start, end_time:end, reason:'Test research session', ...extra };
}

export async function directReservation(f, userKey, input, kind = 'booking') {
  return transaction(f.pool, f.users[userKey].id, async client => (await client.query(`
    INSERT INTO reservations(equipment_id,user_id,kind,start_time,end_time,reason,override_reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
  [input.equipment_id,kind === 'booking' ? f.users[userKey].id : null,kind,input.start_time,input.end_time,input.reason,input.override_reason || null])).rows[0]);
}
export async function waiting(f, key, input) {
  return transaction(f.pool, f.users[key].id, async client => (await client.query(`
    INSERT INTO waitlist(equipment_id,user_id,requested_start,requested_end,reason)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`,
  [input.equipment_id,f.users[key].id,input.start_time,input.end_time,input.reason])).rows[0]);
}
