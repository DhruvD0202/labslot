import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fixture, slot, directReservation, waiting } from './helpers.js';

let f;
before(async()=>{ f=await fixture(); });
after(async()=>{ await f?.close(); });
const as = key => ({ Authorization:`Bearer ${f.token(key)}` });

test('JWT authentication, invalid input, and student-only self-registration', async()=>{
  await request(f.app).get('/api/equipment').expect(401);
  await request(f.app).get('/api/equipment').set('Authorization','Bearer invalid').expect(401);
  const login = await request(f.app).post('/api/auth/login').send({email:'student@example.test',password:'test-password-123'}).expect(200);
  assert.ok(login.body.token); assert.equal(login.body.user.role,'student'); assert.equal(login.body.user.password_hash,undefined);
  await request(f.app).post('/api/auth/register').send({name:'New user',email:'new@example.test',password:'test-password-123',role:'faculty'}).expect(400);
  const registration = await request(f.app).post('/api/auth/register').send({name:'New user',email:'new@example.test',password:'test-password-123'}).expect(201);
  assert.equal(registration.body.user.role,'student');
  await request(f.app).post('/api/bookings').set(as('student')).send({}).expect(400);
});

test('current DB role and active status override stale JWT claims', async()=>{
  const facultyToken = f.token('faculty2');
  await f.pool.query("UPDATE users SET role='student' WHERE id=$1",[f.users.faculty2.id]);
  const asset=await f.asset();
  await request(f.app).post('/api/maintenance').set('Authorization',`Bearer ${facultyToken}`).send(slot(asset)).expect(403);
  await f.pool.query("UPDATE users SET role='faculty' WHERE id=$1",[f.users.faculty2.id]);
  const token=f.token('student2');
  await f.pool.query('UPDATE users SET is_active=false WHERE id=$1',[f.users.student2.id]);
  await request(f.app).get('/api/equipment').set('Authorization',`Bearer ${token}`).expect(401);
  await f.pool.query('UPDATE users SET is_active=true WHERE id=$1',[f.users.student2.id]);
});

test('12 concurrent HTTP booking requests result in exactly one confirmed reservation', async()=>{
  const asset=await f.asset();
  const responses=await Promise.all(Array.from({length:12},()=>request(f.app).post('/api/bookings').set(as('student')).send(slot(asset))));
  assert.equal(responses.filter(r=>r.status===201).length,1);
  assert.equal(responses.filter(r=>r.status===409 && r.body.code==='SLOT_CONFLICT').length,11);
  assert.equal((await f.pool.query("SELECT count(*) FROM reservations WHERE equipment_id=$1 AND status='reserved'",[asset.id])).rows[0].count,'1');
});

test('API returns useful conflicts, prevents unauthorized cancellation, and atomically promotes', async()=>{
  const asset=await f.asset();
  const booking=await directReservation(f,'student',slot(asset));
  const conflict=await request(f.app).post('/api/bookings').set(as('student2')).send(slot(asset)).expect(409);
  assert.equal(conflict.body.code,'SLOT_CONFLICT');
  await request(f.app).post('/api/waitlist').set(as('student2')).send(slot(asset)).expect(201);
  await request(f.app).post(`/api/reservations/${booking.id}/cancel`).set(as('student2')).send({reason:'Not my booking'}).expect(403);
  const cancelled=await request(f.app).post(`/api/reservations/${booking.id}/cancel`).set(as('student')).send({reason:'Changed plans'}).expect(200);
  assert.ok(cancelled.body.promoted_reservation_id);
  assert.equal((await f.pool.query('SELECT user_id FROM reservations WHERE id=$1',[cancelled.body.promoted_reservation_id])).rows[0].user_id,f.users.student2.id);
});

test('calendar times remain campus-local and malformed dates or offsets are rejected', async()=>{
  const asset=await f.asset();
  await directReservation(f,'student',slot(asset));
  const result=await request(f.app).get('/api/calendar').set(as('student')).query({equipment_id:asset.id,start:'2035-01-05T00:00',end:'2035-01-06T00:00'}).expect(200);
  assert.equal(result.body[0].start_time,'2035-01-05T09:00:00');
  await request(f.app).post('/api/bookings').set(as('student')).send(slot(asset,'2035-02-30T09:00','2035-02-30T10:00')).expect(400);
  await request(f.app).post('/api/bookings').set(as('student')).send(slot(asset,'2035-01-05T09:00Z','2035-01-05T10:00Z')).expect(400);
});

test('maintenance and manual promotion endpoints require faculty; waitlist withdrawals require ownership', async()=>{
  const asset=await f.asset();
  await request(f.app).post('/api/maintenance').set(as('student')).send(slot(asset)).expect(403);
  await request(f.app).post(`/api/equipment/${asset.id}/promote`).set(as('student')).send({}).expect(403);
  const queued=await waiting(f,'student',slot(asset));
  await request(f.app).post(`/api/waitlist/${queued.id}/withdraw`).set(as('student2')).send({}).expect(403);
  await request(f.app).post(`/api/waitlist/${queued.id}/withdraw`).set(as('student')).send({}).expect(200);
  await waiting(f,'student2',slot(asset));
  const promotion=await request(f.app).post(`/api/equipment/${asset.id}/promote`).set(as('faculty')).send({}).expect(200);
  assert.ok(promotion.body.promoted_reservation_id);
});
