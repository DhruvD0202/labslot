import assert from 'node:assert/strict';
import request from 'supertest';
import { fixture, slot } from '../tests/helpers.js';

const contenders = Number(process.env.CONCURRENCY || 20);
if (!Number.isInteger(contenders) || contenders < 2 || contenders > 100) throw new Error('CONCURRENCY must be an integer from 2 to 100.');
const f = await fixture();
try {
  const asset = await f.asset();
  const serverVersion = (await f.pool.query('SHOW server_version')).rows[0].server_version;
  const started = performance.now();
  const results = await Promise.all(Array.from({length:contenders},(_,index)=>request(f.app).post('/api/bookings')
    .set('Authorization',`Bearer ${f.token(index%2 ? 'student' : 'student2')}`).send(slot(asset))));
  const accepted = results.filter(result=>result.status===201).length;
  const conflicts = results.filter(result=>result.status===409 && result.body.code==='SLOT_CONFLICT').length;
  const stored = Number((await f.pool.query("SELECT count(*) FROM reservations WHERE equipment_id=$1 AND status='reserved'",[asset.id])).rows[0].count);
  assert.equal(accepted,1); assert.equal(conflicts,contenders-1); assert.equal(stored,1);
  console.log(JSON.stringify({postgresql:serverVersion,simultaneous_http_requests:contenders,confirmed:accepted,conflicts,stored_reservations:stored,elapsed_ms:Math.round(performance.now()-started),result:'PASS'},null,2));
} finally { await f.close(); }
