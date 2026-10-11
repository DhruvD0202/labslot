import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, slot, directReservation, waiting, fixedNow } from './helpers.js';
import { transaction } from '../server/db.js';
import { cancel } from '../server/services/bookings.js';

let f;
before(async () => { f = await fixture(); });
after(async () => { await f?.close(); });

test('half-open boundaries allow adjacency; identical and nested intervals are rejected', async () => {
  const asset = await f.asset();
  await directReservation(f,'student',slot(asset));
  await directReservation(f,'student2',slot(asset,'2035-01-05T10:00','2035-01-05T11:00'));
  await assert.rejects(directReservation(f,'student2',slot(asset)), { code:'23P01' });
  await assert.rejects(directReservation(f,'student2',slot(asset,'2035-01-05T09:15','2035-01-05T09:30')), { code:'23P01' });
  const other = await f.asset();
  await directReservation(f,'student2',slot(other));
});

test('booking-versus-maintenance and maintenance-versus-maintenance use the same constraint', async () => {
  const asset = await f.asset();
  await directReservation(f,'faculty',slot(asset),'maintenance');
  await assert.rejects(directReservation(f,'student',slot(asset)), { code:'23P01' });
  await assert.rejects(directReservation(f,'faculty',slot(asset),'maintenance'), { code:'23P01' });
  await assert.rejects(directReservation(f,'faculty',slot(asset,undefined,undefined,{ override_reason:'Urgent experiment' })), { code:'P0001' });
  const second = await f.asset();
  await directReservation(f,'student',slot(second));
  await assert.rejects(directReservation(f,'faculty',slot(second),'maintenance'), { code:'23P01' });
});

test('faculty override displaces all eligible bookings, preserves exact intervals, and logs links', async () => {
  const asset = await f.asset();
  const a = await directReservation(f,'student',slot(asset));
  const b = await directReservation(f,'student2',slot(asset,'2035-01-05T10:00','2035-01-05T11:00'));
  const faculty = await directReservation(f,'faculty',slot(asset,'2035-01-05T09:30','2035-01-05T10:30',{ override_reason:'Time-sensitive research' }));
  const displaced = (await f.pool.query('SELECT status FROM reservations WHERE id=ANY($1::uuid[])', [[a.id,b.id]])).rows;
  assert.deepEqual(displaced.map(r=>r.status),['displaced','displaced']);
  const queued = (await f.pool.query('SELECT requested_start,requested_end FROM waitlist WHERE equipment_id=$1 ORDER BY requested_start',[asset.id])).rows;
  assert.equal(queued.length,2);
  assert.equal(queued[0].requested_start,'2035-01-05T09:00:00');
  assert.equal(queued[1].requested_end,'2035-01-05T11:00:00');
  const events = (await f.pool.query("SELECT * FROM reservation_events WHERE related_reservation_id=$1 AND event_type='overridden'",[faculty.id])).rows;
  assert.equal(events.length,2); assert.ok(events.every(event=>event.waitlist_id));
});

test('mixed protected conflicts reject the whole override without displacing eligible students', async () => {
  const asset = await f.asset();
  const student = await directReservation(f,'student',slot(asset));
  await directReservation(f,'faculty2',slot(asset,'2035-01-05T10:00','2035-01-05T11:00'));
  await assert.rejects(directReservation(f,'faculty',slot(asset,'2035-01-05T09:00','2035-01-05T11:00',{override_reason:'Priority research'})), {code:'P0001'});
  assert.equal((await f.pool.query('SELECT status FROM reservations WHERE id=$1',[student.id])).rows[0].status,'reserved');
  assert.equal((await f.pool.query('SELECT 1 FROM waitlist WHERE equipment_id=$1',[asset.id])).rowCount,0);
});

test('less than 24 hours is protected, and exactly 24 hours is eligible', async () => {
  const asset = await f.asset();
  await directReservation(f,'student',slot(asset,'2035-01-02T07:59','2035-01-02T09:00'));
  await assert.rejects(directReservation(f,'faculty',slot(asset,'2035-01-02T07:59','2035-01-02T09:00',{override_reason:'Urgent experiment'})),{code:'P0001'});
  const second = await f.asset();
  await directReservation(f,'student',slot(second,'2035-01-02T08:00','2035-01-02T09:00'));
  await directReservation(f,'faculty',slot(second,'2035-01-02T08:00','2035-01-02T09:00',{override_reason:'Urgent experiment'}));
});

test('students cannot override or create maintenance; inactive equipment rejects requests', async () => {
  const asset = await f.asset();
  await assert.rejects(directReservation(f,'student',slot(asset,undefined,undefined,{override_reason:'Attempted override'})),{code:'42501'});
  await assert.rejects(directReservation(f,'student',slot(asset),'maintenance'),{code:'42501'});
  const inactive = await f.asset('out_of_service');
  await assert.rejects(directReservation(f,'student',slot(inactive)),{code:'P0001'});
});

test('a constraint failure AFTER trigger displacement rolls back bookings, queue, and audit', async () => {
  const asset = await f.asset();
  const student = await directReservation(f,'student',slot(asset));
  const initialEvents = (await f.pool.query('SELECT count(*) FROM reservation_events')).rows[0].count;
  // Trigger runs first; final row CHECK rejects this too-short reason.
  await assert.rejects(directReservation(f,'faculty',slot(asset,undefined,undefined,{override_reason:'bad'})),{code:'23514'});
  assert.equal((await f.pool.query('SELECT status FROM reservations WHERE id=$1',[student.id])).rows[0].status,'reserved');
  assert.equal((await f.pool.query('SELECT 1 FROM waitlist WHERE equipment_id=$1',[asset.id])).rowCount,0);
  assert.equal((await f.pool.query('SELECT count(*) FROM reservation_events')).rows[0].count,initialEvents);
});

test('cancellation promotes faculty before an older student request and links audit to the queue', async () => {
  const asset = await f.asset();
  const original = await directReservation(f,'student',slot(asset));
  await waiting(f,'student2',slot(asset));
  const facultyRequest = await waiting(f,'faculty',slot(asset));
  const result = await cancel(f.pool,f.users.student,original.id,'Schedule changed');
  const promoted = (await f.pool.query('SELECT * FROM reservations WHERE id=$1',[result.promoted_reservation_id])).rows[0];
  assert.equal(promoted.user_id,f.users.faculty.id);
  assert.equal((await f.pool.query('SELECT status FROM waitlist WHERE id=$1',[facultyRequest.id])).rows[0].status,'promoted');
  assert.equal((await f.pool.query("SELECT 1 FROM reservation_events WHERE event_type='promoted' AND waitlist_id=$1 AND reservation_id=$2",[facultyRequest.id,promoted.id])).rowCount,1);
});

test('promotion requires the whole interval to fit and skips an earlier request that does not fit', async () => {
  const asset = await f.asset();
  const original = await directReservation(f,'student',slot(asset));
  await directReservation(f,'student',slot(asset,'2035-01-05T10:00','2035-01-05T11:00'));
  const blocked = await waiting(f,'faculty',slot(asset,'2035-01-05T09:00','2035-01-05T11:00'));
  await waiting(f,'student2',slot(asset));
  const result = await cancel(f.pool,f.users.student,original.id,'Finished planning');
  assert.equal((await f.pool.query('SELECT user_id FROM reservations WHERE id=$1',[result.promoted_reservation_id])).rows[0].user_id,f.users.student2.id);
  assert.equal((await f.pool.query('SELECT status FROM waitlist WHERE id=$1',[blocked.id])).rows[0].status,'waiting');
});

test('rolling back cancellation restores both the original booking and the waiting request', async () => {
  const asset = await f.asset();
  const original = await directReservation(f,'student',slot(asset));
  const queued = await waiting(f,'student2',slot(asset));
  await assert.rejects(transaction(f.pool,f.users.student.id,async client => {
    const result = (await client.query('SELECT cancel_reservation($1,$2) AS promoted',[original.id,'Rollback test'])).rows[0];
    assert.ok(result.promoted);
    throw new Error('Simulated failure before COMMIT');
  }),/Simulated failure/);
  assert.equal((await f.pool.query('SELECT status FROM reservations WHERE id=$1',[original.id])).rows[0].status,'reserved');
  assert.equal((await f.pool.query('SELECT status FROM waitlist WHERE id=$1',[queued.id])).rows[0].status,'waiting');
  assert.equal((await f.pool.query('SELECT 1 FROM reservations WHERE equipment_id=$1',[asset.id])).rowCount,1);
});

test('two concurrent cancellations cannot promote the same request twice', async () => {
  const asset = await f.asset();
  const original = await directReservation(f,'student',slot(asset));
  await waiting(f,'student2',slot(asset));
  const results = await Promise.allSettled([
    cancel(f.pool,f.users.student,original.id,'Cancel A'),cancel(f.pool,f.users.student,original.id,'Cancel B'),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='P0001').length,1);
  assert.equal((await f.pool.query("SELECT 1 FROM reservations WHERE equipment_id=$1 AND status='reserved'",[asset.id])).rowCount,1);
});

test('faculty override racing cancellation/promotion leaves a consistent schedule', async () => {
  const asset = await f.asset();
  const original = await directReservation(f,'student',slot(asset));
  await waiting(f,'student2',slot(asset));
  const result = await Promise.allSettled([
    cancel(f.pool,f.users.student,original.id,'Concurrent cancellation'),
    directReservation(f,'faculty',slot(asset,undefined,undefined,{override_reason:'Faculty race test'})),
  ]);
  assert.equal(result[1].status,'fulfilled');
  const active = (await f.pool.query("SELECT * FROM reservations WHERE equipment_id=$1 AND status='reserved'",[asset.id])).rows;
  assert.equal(active.length,1); assert.equal(active[0].user_id,f.users.faculty.id);
  assert.equal((await f.pool.query(`SELECT 1 FROM waitlist w JOIN reservations r ON r.user_id=w.user_id AND r.equipment_id=w.equipment_id
    WHERE w.equipment_id=$1 AND w.status='promoted' AND r.status='reserved' AND r.user_id<>$2`,[asset.id,f.users.faculty.id])).rowCount,0);
});

test('duplicate active waitlist entries, empty ranges, and invalid foreign keys are rejected', async () => {
  const asset = await f.asset();
  await waiting(f,'student',slot(asset));
  await assert.rejects(waiting(f,'student',slot(asset)),{code:'23505'});
  await assert.rejects(directReservation(f,'student',slot(asset,'2035-01-05T09:00','2035-01-05T09:00')),{code:'23514'});
  await assert.rejects(f.pool.query('INSERT INTO usage_logs(reservation_id,actual_start) VALUES ($1,$2)',[randomUUID(),fixedNow]));
  await assert.rejects(f.pool.query("INSERT INTO reservation_events(reservation_id,event_type,reason) VALUES ($1,'booking_created','Invalid FK')",[randomUUID()]),{code:'23503'});
});

test('reservation and audit history cannot be edited or deleted', async () => {
  const asset = await f.asset();
  const booking = await directReservation(f,'student',slot(asset));
  await assert.rejects(transaction(f.pool,f.users.student.id,client=>client.query("UPDATE reservations SET reason='Changed' WHERE id=$1",[booking.id])),{code:'22023'});
  await assert.rejects(f.pool.query('DELETE FROM reservations WHERE id=$1',[booking.id]),{code:'42501'});
  await assert.rejects(f.pool.query("UPDATE reservation_events SET reason='Changed' WHERE reservation_id=$1",[booking.id]),{code:'42501'});
});

test('usage can only be recorded by the owner during a booking, with one checkout', async () => {
  const asset = await f.asset();
  const booking = await directReservation(f,'student',slot(asset));
  await assert.rejects(transaction(f.pool,f.users.student.id,client=>client.query('INSERT INTO usage_logs(reservation_id,actual_start) VALUES ($1,campus_now())',[booking.id])),{code:'P0001'});
  await f.at('2035-01-05T09:15:00');
  try {
    await assert.rejects(transaction(f.pool,f.users.student2.id,client=>client.query('INSERT INTO usage_logs(reservation_id,actual_start) VALUES ($1,campus_now())',[booking.id])),{code:'42501'});
    await transaction(f.pool,f.users.student.id,client=>client.query('INSERT INTO usage_logs(reservation_id,actual_start) VALUES ($1,campus_now())',[booking.id]));
    await assert.rejects(cancel(f.pool,f.users.student,booking.id,'In progress'),{code:'P0001'});
    await f.at('2035-01-05T09:45:00');
    await transaction(f.pool,f.users.student.id,client=>client.query('UPDATE usage_logs SET actual_end=campus_now() WHERE reservation_id=$1',[booking.id]));
    await assert.rejects(transaction(f.pool,f.users.student.id,client=>client.query('UPDATE usage_logs SET actual_end=campus_now() WHERE reservation_id=$1',[booking.id])),{code:'22023'});
  } finally { await f.at(fixedNow); }
});

test('EXCLUDE alone blocks a concurrent uncommitted insert, then returns SQLSTATE 23P01', async () => {
  // LIKE INCLUDING ALL copies the production exclusion constraint and checks,
  // without workflow triggers/equipment locks. This isolates the DB guarantee.
  await f.pool.query('CREATE TABLE exclusion_probe (LIKE reservations INCLUDING ALL)');
  const exclusions = (await f.pool.query("SELECT count(*) FROM pg_constraint WHERE conrelid='exclusion_probe'::regclass AND contype='x'")).rows[0].count;
  assert.equal(exclusions,'1');
  const a = await f.pool.connect(); const b = await f.pool.connect();
  const asset = randomUUID();
  const sql = `INSERT INTO exclusion_probe(equipment_id,user_id,kind,start_time,end_time,reason)
    VALUES ($1,$2,'booking','2035-01-05 09:00','2035-01-05 10:00','Concurrent constraint test')`;
  try {
    await a.query('BEGIN'); await b.query('BEGIN');
    await b.query("SET LOCAL statement_timeout='5s'");
    const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await a.query(sql,[asset,f.users.student.id]);
    const pending = b.query(sql,[asset,f.users.student2.id]).then(()=>({ok:true}),error=>({error}));
    let observedWait = false;
    for (let i=0;i<100;i++) {
      const state = (await f.pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
      if (state?.wait_event_type === 'Lock') { observedWait = true; break; }
      await delay(20);
    }
    assert.equal(observedWait,true,'Second PostgreSQL backend must actually wait on the uncommitted conflict');
    await a.query('COMMIT');
    const outcome = await pending;
    assert.equal(outcome.error?.code,'23P01');
    await b.query('ROLLBACK');
    assert.equal((await f.pool.query('SELECT count(*) FROM exclusion_probe')).rows[0].count,'1');
  } finally { await a.query('ROLLBACK'); await b.query('ROLLBACK'); a.release(); b.release(); }
});
