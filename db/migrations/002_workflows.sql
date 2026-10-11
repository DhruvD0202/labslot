-- The HTTP server is the trusted DB client. It verifies JWTs, looks up the current
-- user, and sets app.user_id with set_config(..., true) inside each transaction.
-- End users never receive DB credentials. These are NOT SECURITY DEFINER functions.
CREATE FUNCTION campus_now() RETURNS timestamp LANGUAGE sql VOLATILE AS $$
  SELECT clock_timestamp() AT TIME ZONE 'Asia/Kolkata'
$$;

CREATE FUNCTION request_actor() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE actor uuid;
BEGIN
  actor := nullif(current_setting('app.user_id', true), '')::uuid;
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = actor AND is_active) THEN
    RAISE EXCEPTION 'An active user is required.' USING ERRCODE = '42501';
  END IF;
  RETURN actor;
END;
$$;

CREATE FUNCTION protect_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid; actor_role text; target_role text; asset_status text;
        conflict reservations%ROWTYPE; queue_id uuid;
BEGIN
  actor := request_actor();
  SELECT role INTO actor_role FROM users WHERE id = actor;

  -- Every workflow uses the equipment row as the first lock. READ COMMITTED
  -- gives subsequent statements a fresh snapshot after waiting for this lock.
  SELECT operational_status INTO asset_status FROM equipment WHERE id = NEW.equipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Equipment not found.' USING ERRCODE = 'P0002';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.equipment_id, NEW.user_id, NEW.kind, NEW.start_time, NEW.end_time,
           NEW.reason, NEW.override_reason, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.equipment_id, OLD.user_id, OLD.kind, OLD.start_time, OLD.end_time,
           OLD.reason, OLD.override_reason, OLD.created_at) THEN
      RAISE EXCEPTION 'Reservation details are immutable. Cancel and create a new booking.' USING ERRCODE = '22023';
    END IF;
    IF OLD.status <> 'reserved' OR NEW.status NOT IN ('cancelled', 'displaced') THEN
      RAISE EXCEPTION 'Invalid reservation status transition.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM usage_logs WHERE reservation_id = OLD.id) THEN
      RAISE EXCEPTION 'A booking with recorded usage cannot be cancelled or displaced.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'reserved' THEN
    RAISE EXCEPTION 'New reservations must be reserved.' USING ERRCODE = '22023';
  END IF;
  IF asset_status <> 'active' THEN
    RAISE EXCEPTION 'This equipment is not operational.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.start_time <= campus_now() THEN
    RAISE EXCEPTION 'Choose a future start time.' USING ERRCODE = '22023';
  END IF;
  IF NEW.kind = 'maintenance' AND actor_role <> 'faculty' THEN
    RAISE EXCEPTION 'Only faculty can schedule maintenance.' USING ERRCODE = '42501';
  END IF;
  IF NEW.kind = 'booking' THEN
    SELECT role INTO target_role FROM users WHERE id = NEW.user_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The booking user is inactive or missing.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A normal insertion goes straight to EXCLUDE. Only explicit, justified faculty
  -- override requests execute displacement logic. Promotion never overrides.
  IF NEW.override_reason IS NOT NULL THEN
    IF NEW.kind <> 'booking' OR actor <> NEW.user_id OR actor_role <> 'faculty' THEN
      RAISE EXCEPTION 'Only faculty can request a priority override for their own booking.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM reservations r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.equipment_id = NEW.equipment_id AND r.status = 'reserved'
        AND tsrange(r.start_time, r.end_time, '[)') && tsrange(NEW.start_time, NEW.end_time, '[)')
        AND (r.kind = 'maintenance' OR u.role IS DISTINCT FROM 'student'
          OR r.start_time < campus_now() + interval '24 hours'
          OR EXISTS (SELECT 1 FROM usage_logs l WHERE l.reservation_id = r.id))
    ) THEN
      RAISE EXCEPTION 'Override denied: only unused student bookings at least 24 hours away can be displaced.' USING ERRCODE = 'P0001';
    END IF;

    FOR conflict IN SELECT * FROM reservations r
      WHERE r.equipment_id = NEW.equipment_id AND r.status = 'reserved'
        AND tsrange(r.start_time, r.end_time, '[)') && tsrange(NEW.start_time, NEW.end_time, '[)')
      ORDER BY r.id FOR UPDATE
    LOOP
      UPDATE reservations SET status = 'displaced' WHERE id = conflict.id;
      INSERT INTO waitlist(equipment_id, user_id, requested_start, requested_end, reason)
        VALUES (conflict.equipment_id, conflict.user_id, conflict.start_time, conflict.end_time, conflict.reason)
        ON CONFLICT (equipment_id, user_id, requested_start, requested_end) WHERE status = 'waiting'
        DO UPDATE SET reason = waitlist.reason RETURNING id INTO queue_id;
      INSERT INTO reservation_events(reservation_id, event_type, actor_user_id, reason, related_reservation_id, waitlist_id)
        VALUES (conflict.id, 'overridden', actor, NEW.override_reason, NEW.id, queue_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservations_guard BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION protect_reservation();

CREATE FUNCTION audit_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO reservation_events(reservation_id, event_type, actor_user_id, reason)
      VALUES (NEW.id, CASE WHEN NEW.kind = 'booking' THEN 'booking_created' ELSE 'maintenance_created' END,
        request_actor(), NEW.reason);
  ELSIF NEW.status = 'cancelled' THEN
    INSERT INTO reservation_events(reservation_id, event_type, actor_user_id, reason)
      VALUES (NEW.id, 'cancelled', request_actor(), coalesce(nullif(current_setting('app.reason', true), ''), 'Cancelled'));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservations_audit AFTER INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION audit_reservation();

CREATE FUNCTION protect_waitlist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM request_actor();
  PERFORM 1 FROM equipment WHERE id = NEW.equipment_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'waiting' OR NEW.requested_start <= campus_now() THEN
      RAISE EXCEPTION 'Waitlist requests must be waiting and start in the future.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM equipment WHERE id = NEW.equipment_id AND operational_status = 'active')
      OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND is_active) THEN
      RAISE EXCEPTION 'Waitlist requires an active user and operational equipment.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW.equipment_id, NEW.user_id, NEW.requested_start, NEW.requested_end, NEW.reason, NEW.queued_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.equipment_id, OLD.user_id, OLD.requested_start, OLD.requested_end, OLD.reason, OLD.queued_at) THEN
      RAISE EXCEPTION 'Waitlist request details are immutable.' USING ERRCODE = '22023';
    END IF;
    -- Allow a no-op update when an override reuses an existing waiting request.
    IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status <> 'waiting' OR NEW.status NOT IN ('promoted','withdrawn')) THEN
      RAISE EXCEPTION 'Invalid waitlist status transition.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER waitlist_guard BEFORE INSERT OR UPDATE ON waitlist FOR EACH ROW EXECUTE FUNCTION protect_waitlist();

CREATE FUNCTION audit_waitlist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO reservation_events(waitlist_id, event_type, actor_user_id, reason)
      VALUES (NEW.id, 'waitlisted', request_actor(), NEW.reason);
  ELSIF NEW.status = 'withdrawn' AND OLD.status <> NEW.status THEN
    INSERT INTO reservation_events(waitlist_id, event_type, actor_user_id, reason)
      VALUES (NEW.id, 'withdrawn', request_actor(), 'Withdrawn from waitlist');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER waitlist_audit AFTER INSERT OR UPDATE ON waitlist FOR EACH ROW EXECUTE FUNCTION audit_waitlist();

-- Internal helper: caller already has authorization. All callers lock equipment
-- first; this lock is reentrant within a transaction. No SKIP LOCKED: it would
-- permit skipping a higher-priority candidate and weaken the stated ordering.
CREATE FUNCTION promote_next(p_equipment uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE candidate waitlist%ROWTYPE; new_id uuid;
BEGIN
  PERFORM request_actor();
  PERFORM 1 FROM equipment WHERE id = p_equipment FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM equipment WHERE id = p_equipment AND operational_status = 'active') THEN
    RETURN NULL;
  END IF;
  SELECT w.* INTO candidate FROM waitlist w JOIN users u ON u.id = w.user_id
    WHERE w.equipment_id = p_equipment AND w.status = 'waiting' AND u.is_active
      AND w.requested_start > campus_now()
      AND NOT EXISTS (
        SELECT 1 FROM reservations r WHERE r.equipment_id = p_equipment AND r.status = 'reserved'
          AND tsrange(r.start_time, r.end_time, '[)') && tsrange(w.requested_start, w.requested_end, '[)')
      )
    ORDER BY CASE u.role WHEN 'faculty' THEN 0 ELSE 1 END, w.queued_at, w.id
    LIMIT 1 FOR UPDATE OF w;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO reservations(equipment_id, user_id, kind, start_time, end_time, reason)
    VALUES (p_equipment, candidate.user_id, 'booking', candidate.requested_start, candidate.requested_end, candidate.reason)
    RETURNING id INTO new_id;
  UPDATE waitlist SET status = 'promoted' WHERE id = candidate.id;
  INSERT INTO reservation_events(reservation_id, waitlist_id, event_type, actor_user_id, reason)
    VALUES (new_id, candidate.id, 'promoted', request_actor(), 'Next eligible request: faculty first, then queue time and ID');
  RETURN new_id;
END;
$$;

CREATE FUNCTION cancel_reservation(p_reservation uuid, p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE target reservations%ROWTYPE; asset uuid; actor uuid;
BEGIN
  actor := request_actor();
  SELECT equipment_id INTO asset FROM reservations WHERE id = p_reservation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM equipment WHERE id = asset FOR UPDATE;
  SELECT * INTO target FROM reservations WHERE id = p_reservation FOR UPDATE;
  IF (target.kind = 'booking' AND target.user_id <> actor)
    OR (target.kind = 'maintenance' AND NOT EXISTS (SELECT 1 FROM users WHERE id = actor AND role = 'faculty')) THEN
    RAISE EXCEPTION 'You cannot cancel this reservation.' USING ERRCODE = '42501';
  END IF;
  IF target.status <> 'reserved' OR target.start_time <= campus_now() THEN
    RAISE EXCEPTION 'Only upcoming reserved intervals can be cancelled.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.reason', p_reason, true);
  UPDATE reservations SET status = 'cancelled' WHERE id = target.id;
  -- Both the release and promotion are part of the CALLER'S one transaction.
  RETURN promote_next(asset);
END;
$$;

CREATE FUNCTION withdraw_waitlist(p_waitlist uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target waitlist%ROWTYPE; asset uuid;
BEGIN
  SELECT equipment_id INTO asset FROM waitlist WHERE id = p_waitlist;
  IF NOT FOUND THEN RAISE EXCEPTION 'Waitlist entry not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM equipment WHERE id = asset FOR UPDATE;
  SELECT * INTO target FROM waitlist WHERE id = p_waitlist FOR UPDATE;
  IF target.user_id <> request_actor() THEN
    RAISE EXCEPTION 'You can only withdraw your own request.' USING ERRCODE = '42501';
  END IF;
  IF target.status <> 'waiting' THEN
    RAISE EXCEPTION 'This request is no longer waiting.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE waitlist SET status = 'withdrawn' WHERE id = p_waitlist;
END;
$$;

CREATE FUNCTION protect_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target reservations%ROWTYPE; asset uuid;
BEGIN
  SELECT equipment_id INTO asset FROM reservations WHERE id = NEW.reservation_id;
  PERFORM 1 FROM equipment WHERE id = asset FOR UPDATE;
  SELECT * INTO target FROM reservations WHERE id = NEW.reservation_id FOR UPDATE;
  IF NOT FOUND OR target.kind <> 'booking' OR target.status <> 'reserved' THEN
    RAISE EXCEPTION 'Usage must belong to a reserved booking.' USING ERRCODE = '22023';
  END IF;
  IF target.user_id <> request_actor() THEN
    RAISE EXCEPTION 'You can only record your own usage.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF campus_now() < target.start_time OR campus_now() >= target.end_time THEN
      RAISE EXCEPTION 'Check in during your booked interval.' USING ERRCODE = 'P0001';
    END IF;
    NEW.actual_start := campus_now();
    NEW.actual_end := NULL;
  ELSE
    IF ROW(NEW.id, NEW.reservation_id, NEW.actual_start) IS DISTINCT FROM ROW(OLD.id, OLD.reservation_id, OLD.actual_start)
      OR OLD.actual_end IS NOT NULL OR NEW.actual_end IS NULL THEN
      RAISE EXCEPTION 'Usage can only be checked out once.' USING ERRCODE = '22023';
    END IF;
    NEW.actual_end := campus_now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER usage_guard BEFORE INSERT OR UPDATE ON usage_logs FOR EACH ROW EXECUTE FUNCTION protect_usage();

CREATE FUNCTION audit_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO reservation_events(reservation_id, event_type, actor_user_id, reason)
    VALUES (NEW.reservation_id, CASE WHEN TG_OP = 'INSERT' THEN 'usage_started' ELSE 'usage_ended' END,
      request_actor(), CASE WHEN TG_OP = 'INSERT' THEN 'Checked in' ELSE 'Checked out' END);
  RETURN NEW;
END;
$$;
CREATE TRIGGER usage_audit AFTER INSERT OR UPDATE ON usage_logs FOR EACH ROW EXECUTE FUNCTION audit_usage();

CREATE FUNCTION preserve_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'History is retained. Use a status transition instead.' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER reservations_no_delete BEFORE DELETE ON reservations FOR EACH ROW EXECUTE FUNCTION preserve_history();
CREATE TRIGGER waitlist_no_delete BEFORE DELETE ON waitlist FOR EACH ROW EXECUTE FUNCTION preserve_history();
CREATE TRIGGER usage_no_delete BEFORE DELETE ON usage_logs FOR EACH ROW EXECUTE FUNCTION preserve_history();
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON reservation_events FOR EACH ROW EXECUTE FUNCTION preserve_history();
