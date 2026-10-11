import pg from 'pg';
// Prevent node-postgres from interpreting campus wall-clock timestamps in the
// server machine's local zone. Offset-free strings are the scheduling API contract.
pg.types.setTypeParser(1114, value => value.replace(' ', 'T'));

export function createPool(connectionString, extra = {}) {
  const pool = new pg.Pool({ connectionString, max: 20, connectionTimeoutMillis: 5000, ...extra });
  pool.on('error', error => console.error('Database connection error:', error.message));
  return pool;
}

export async function transaction(pool, actorId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SELECT set_config('app.user_id', $1, true)", [actorId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
