import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, facultyOnly } from '../middleware/auth.js';
import { authController } from '../controllers/auth.js';
import { bookingController } from '../controllers/bookings.js';
import { calendarInput, id, notesInput } from '../validation.js';
import { transaction } from '../db.js';

export function apiRouter(pool, config) {
  const router = Router();
  const auth = authController(pool, config.jwtSecret);
  const bookings = bookingController(pool);
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { code: 'RATE_LIMIT', message: 'Too many sign-in attempts. Try again in 15 minutes.' } });
  router.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timezone: 'Asia/Kolkata' });
  });
  router.post('/auth/login', authLimit, auth.login);
  router.post('/auth/register', authLimit, auth.register);
  router.use(authenticate(pool, config.jwtSecret));
  router.get('/auth/me', (req, res) => res.json(req.user));

  router.get('/equipment', async (req, res) => {
    const { rows } = await pool.query(`SELECT e.*, EXISTS (
      SELECT 1 FROM reservations r WHERE r.equipment_id = e.id AND r.status = 'reserved'
        AND tsrange(r.start_time,r.end_time,'[)') @> campus_now()
    ) AS occupied_now FROM equipment e WHERE e.operational_status <> 'retired' ORDER BY e.asset_tag`);
    res.json(rows);
  });
  router.get('/calendar', async (req, res) => {
    const q = calendarInput.parse(req.query);
    const { rows } = await pool.query(`SELECT r.*, u.name AS user_name, u.role AS user_role, e.name AS equipment_name
      FROM reservations r JOIN equipment e ON e.id = r.equipment_id LEFT JOIN users u ON u.id = r.user_id
      WHERE r.equipment_id = $1 AND r.status = 'reserved' AND r.start_time < $3 AND r.end_time > $2
      ORDER BY r.start_time`, [q.equipment_id, q.start, q.end]);
    res.json(rows);
  });
  router.get('/bookings', async (req, res) => {
    const { rows } = await pool.query(`SELECT r.*, e.name AS equipment_name, e.location, l.actual_start, l.actual_end
      FROM reservations r JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN usage_logs l ON l.reservation_id = r.id WHERE r.user_id = $1 ORDER BY r.start_time DESC LIMIT 200`, [req.user.id]);
    res.json(rows);
  });
  router.post('/bookings', bookings.create);
  router.post('/maintenance', facultyOnly, bookings.maintenance);
  router.post('/reservations/:id/cancel', bookings.cancel);

  router.get('/waitlist', async (req, res) => {
    const { rows } = await pool.query(`WITH ranked AS (
      SELECT w.*, row_number() OVER (PARTITION BY w.equipment_id ORDER BY
        CASE u.role WHEN 'faculty' THEN 0 ELSE 1 END, w.queued_at, w.id) AS position
      FROM waitlist w JOIN users u ON u.id = w.user_id
      WHERE w.status = 'waiting' AND u.is_active AND w.requested_start > campus_now()
    ) SELECT w.*, e.name AS equipment_name FROM ranked w JOIN equipment e ON e.id = w.equipment_id
      WHERE w.user_id = $1 ORDER BY w.queued_at`, [req.user.id]);
    res.json(rows);
  });
  router.post('/waitlist', bookings.waitlist);
  router.post('/waitlist/:id/withdraw', async (req, res) => {
    const entryId = id.parse(req.params.id);
    await transaction(pool, req.user.id, client => client.query('SELECT withdraw_waitlist($1)', [entryId]));
    res.json({ message: 'Request withdrawn.' });
  });
  router.post('/equipment/:id/promote', facultyOnly, async (req, res) => {
    const equipmentId = id.parse(req.params.id);
    const result = await transaction(pool, req.user.id, async client => {
      if (!(await client.query('SELECT 1 FROM equipment WHERE id=$1', [equipmentId])).rowCount) {
        const error = new Error('Equipment not found.'); error.code = 'P0002'; throw error;
      }
      return (await client.query('SELECT promote_next($1) AS promoted_reservation_id', [equipmentId])).rows[0];
    });
    res.json(result);
  });
  router.get('/activity', async (req, res) => {
    const { rows } = await pool.query(`SELECT ev.*, u.name AS actor_name,
      e.name AS equipment_name, owner.name AS booking_user_name
      FROM reservation_events ev LEFT JOIN users u ON u.id = ev.actor_user_id
      LEFT JOIN reservations r ON r.id = ev.reservation_id
      LEFT JOIN waitlist w ON w.id = ev.waitlist_id
      LEFT JOIN equipment e ON e.id = coalesce(r.equipment_id,w.equipment_id)
      LEFT JOIN users owner ON owner.id = coalesce(r.user_id,w.user_id)
      WHERE $2 = 'faculty' OR r.user_id = $1 OR w.user_id = $1 OR ev.actor_user_id = $1
      ORDER BY ev.occurred_at DESC, ev.id DESC LIMIT 80`, [req.user.id, req.user.role]);
    res.json(rows);
  });
  router.post('/bookings/:id/check-in', async (req, res) => {
    const bookingId = id.parse(req.params.id);
    const result = await transaction(pool, req.user.id, client => client.query(`INSERT INTO usage_logs(reservation_id,actual_start)
      VALUES ($1,campus_now()) RETURNING *`, [bookingId]));
    res.status(201).json(result.rows[0]);
  });
  router.post('/bookings/:id/check-out', async (req, res) => {
    const bookingId = id.parse(req.params.id);
    const input = notesInput.parse(req.body);
    const result = await transaction(pool, req.user.id, async client => {
      // Equipment first, even on checkout, to match the other scheduling workflows.
      await client.query('SELECT e.id FROM equipment e JOIN reservations r ON r.equipment_id=e.id WHERE r.id=$1 FOR UPDATE OF e', [bookingId]);
      return client.query('UPDATE usage_logs SET actual_end=campus_now(),notes=$2 WHERE reservation_id=$1 RETURNING *', [bookingId,input.notes]);
    });
    if (!result.rowCount) return res.status(404).json({ code:'NOT_FOUND', message:'Check in before checking out.' });
    res.json(result.rows[0]);
  });
  return router;
}
