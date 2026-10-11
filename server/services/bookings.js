import { transaction } from '../db.js';

export async function reserve(pool, actor, input, kind = 'booking') {
  return transaction(pool, actor.id, async client => {
    const { rows } = await client.query(`
      INSERT INTO reservations(equipment_id, user_id, kind, start_time, end_time, reason, override_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.equipment_id, kind === 'booking' ? actor.id : null, kind, input.start_time, input.end_time, input.reason, input.override_reason || null]);
    return rows[0];
  });
}

export async function cancel(pool, actor, reservationId, reason) {
  return transaction(pool, actor.id, async client => {
    const { rows } = await client.query('SELECT cancel_reservation($1, $2) AS promoted_reservation_id', [reservationId, reason]);
    return rows[0];
  });
}

export async function joinWaitlist(pool, actor, input) {
  return transaction(pool, actor.id, async client => {
    const { rows } = await client.query(`INSERT INTO waitlist(equipment_id, user_id, requested_start, requested_end, reason)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.equipment_id, actor.id, input.start_time, input.end_time, input.reason]);
    return rows[0];
  });
}
