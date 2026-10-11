-- LabSlot core schema. All scheduling timestamps are campus-local Asia/Kolkata.
-- Audit/creation timestamps are timestamptz: they describe actual instants.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('faculty', 'student')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  location text NOT NULL,
  description text NOT NULL DEFAULT '',
  operational_status text NOT NULL DEFAULT 'active'
    CHECK (operational_status IN ('active', 'out_of_service', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('booking', 'maintenance')),
  start_time timestamp NOT NULL,
  end_time timestamp NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'cancelled', 'displaced')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  override_reason text CHECK (length(btrim(override_reason)) BETWEEN 5 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_reservation_interval CHECK (
    isfinite(start_time) AND isfinite(end_time) AND start_time < end_time),
  CONSTRAINT reservation_kind_fields CHECK (
    (kind = 'booking' AND user_id IS NOT NULL) OR
    (kind = 'maintenance' AND user_id IS NULL AND override_reason IS NULL AND status <> 'displaced')),
  -- '=' matches the same asset; '&&' matches intersecting time ranges.
  -- EXCLUDE rejects a pair when BOTH comparisons are true. [) permits adjacency.
  -- Cancelled/displaced history stays in the table without occupying the schedule.
  CONSTRAINT reservations_no_overlap EXCLUDE USING gist (
    equipment_id WITH =,
    tsrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status = 'reserved')
);
CREATE INDEX reservations_user_time ON reservations(user_id, start_time);

CREATE TABLE waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_start timestamp NOT NULL,
  requested_end timestamp NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'withdrawn')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_waitlist_interval CHECK (
    isfinite(requested_start) AND isfinite(requested_end) AND requested_start < requested_end)
);
CREATE UNIQUE INDEX waitlist_one_active_request
  ON waitlist(equipment_id, user_id, requested_start, requested_end) WHERE status = 'waiting';
CREATE INDEX waitlist_selection ON waitlist(equipment_id, status, queued_at, id);

CREATE TABLE usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT,
  actual_start timestamp NOT NULL,
  actual_end timestamp,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  CHECK (isfinite(actual_start)),
  CHECK (actual_end IS NULL OR (isfinite(actual_end) AND actual_end >= actual_start))
);

CREATE TABLE reservation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id uuid REFERENCES reservations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'booking_created', 'maintenance_created', 'cancelled', 'overridden',
    'waitlisted', 'promoted', 'withdrawn', 'usage_started', 'usage_ended')),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL,
  -- An override trigger logs the new reservation BEFORE its row is inserted.
  -- Deferring ONLY this FK validates that reference at transaction commit.
  related_reservation_id uuid REFERENCES reservations(id) ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  waitlist_id uuid REFERENCES waitlist(id) ON DELETE RESTRICT,
  CHECK (reservation_id IS NOT NULL OR waitlist_id IS NOT NULL)
);
CREATE INDEX reservation_events_history ON reservation_events(reservation_id, occurred_at DESC);

CREATE VIEW bookings AS SELECT * FROM reservations WHERE kind = 'booking';
CREATE VIEW maintenance_schedule AS SELECT * FROM reservations WHERE kind = 'maintenance';

COMMENT ON TABLE reservations IS 'One scheduling ledger for bookings AND maintenance; interval fields are immutable.';
COMMENT ON TABLE waitlist IS 'Exact-interval demand; priority is joined from current users.role, never stored as a rank.';
COMMENT ON CONSTRAINT reservations_no_overlap ON reservations IS
  'Database overlap protection, independent of frontend availability checks. SQLSTATE 23P01 on conflict.';
