# SQL walkthrough: what to explain in an interview

## 1. Why a SELECT-before-INSERT check is insufficient

Two requests can both query an empty interval before either inserts. Both application checks pass. A database exclusion constraint handles the conflict at insertion/commit time, including conflicting writes from separate connections. GiST is the index mechanism; `=` matches the asset and `&&` tests intersecting ranges.

`[09:00,10:00)` and `[10:00,11:00)` do not overlap. `[09:00,11:00)` and `[10:00,12:00)` do. The partial predicate `status = 'reserved'` makes cancellation release the interval without deleting its history. It does not use `now()` in an index predicate; time passing is not a row update.

## 2. How the faculty trigger works

`reservations_guard`, a `BEFORE INSERT OR UPDATE` trigger, calls `protect_reservation()`.

1. Resolve the authenticated actor from a transaction-local setting and confirm the account is active.
2. Lock the equipment row. Reject new reservations on inactive equipment or in the past.
3. For ordinary insertions, let EXCLUDE decide whether the interval is free.
4. For an explicit override reason, verify that the actor is faculty and is booking for themselves.
5. Inspect **all** overlaps. If any is maintenance, faculty-held, less than 24 hours away, or has usage, raise an exception.
6. Change each eligible student allocation to `displaced`. Insert/reuse an exact-interval waiting request and insert an override event.
7. Return the new row so PostgreSQL can validate checks, foreign keys, and EXCLUDE and insert the faculty booking.

The event's `related_reservation_id` points to a faculty row that has not yet been inserted when the BEFORE trigger runs. Only that foreign key is `DEFERRABLE INITIALLY DEFERRED`: it is checked at transaction commit. The exclusion constraint remains immediate.

A failure at any later step rolls back all earlier displacement/queue/event writes. The tests deliberately give the new faculty row an invalid short reason so a final CHECK fails after the trigger's work, then verify that no partial effects survive.

An AFTER trigger writes creation/cancellation events. It does **not** automatically promote on every status update. If it promoted during displacement, it could immediately refill an interval that the incoming faculty booking needs. Promotion occurs only in the explicit cancellation/manual-promotion workflows.

## 3. Cancellation and promotion are one transaction

The HTTP server uses one checked-out `pg` connection for every statement in the transaction. It never uses unrelated `pool.query()` calls for BEGIN and COMMIT.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('app.user_id', '<authenticated-user-uuid>', true);
SELECT cancel_reservation('<reservation-uuid>', 'Experiment rescheduled');
COMMIT;
```

`cancel_reservation` finds the immutable equipment ID, locks that asset, then locks/rechecks the reservation. It checks ownership (or faculty authority for maintenance), verifies it is an upcoming retained allocation, changes status, and calls `promote_next` in the same transaction.

`promote_next` selects the earliest eligible request using:

```sql
ORDER BY CASE users.role WHEN 'faculty' THEN 0 ELSE 1 END,
         waitlist.queued_at,
         waitlist.id
```

Eligibility includes a NOT EXISTS overlap query for the **entire** requested interval. The selected request is locked, its booking inserted, its status changed to `promoted`, and an audit event linked to both records. If no request fits, cancellation still succeeds and promotion returns null. At most one request is promoted per call.

The overlap query selects a candidate, while EXCLUDE remains the final integrity check. The promotion does not request an override. A later queued request can be selected if an earlier request does not fit.

## 4. Why both the equipment lock and EXCLUDE exist

They have different jobs:

- **Equipment row lock:** coordinates multi-step scheduling workflows for one asset, including cancellations, waitlist state, maintenance, and usage. Different assets have different row locks.
- **EXCLUDE:** prevents overlapping allocated intervals regardless of whether an application availability check was correct.

Normal workflows lock the equipment first, then reservation/request rows, to keep a consistent lock order. They use READ COMMITTED so later statements see changes committed while waiting for the lock. Trigger functions are VOLATILE by default and their SQL statements can obtain fresh snapshots. Lock/statement timeouts surface useful retry errors rather than waiting indefinitely.

We do not use `SKIP LOCKED` to jump past a higher-priority candidate. We also do not claim all possible owner-issued raw SQL follows this protocol: the application's trusted connection and supplied workflows define the business-operation boundary. EXCLUDE still protects the schedule.

## 5. Authorization is layered

The server verifies JWT signature, algorithm, issuer, audience, and expiry, then reads current account state. The browser cannot submit a booking owner or a registration role. Faculty maintenance/promotion routes have explicit authorization. The database enforces override role, ownership in cancellation/withdrawal/usage functions, valid state transitions, and interval checks.

`app.user_id` is set transaction-locally by the trusted server, not accepted as an HTTP parameter. It is an audit/auth context, not a credential usable by arbitrary database users. No SECURITY DEFINER privilege escalation is used. A deployable least-privilege runtime role should be added before real production use. Administrative seed code can book on behalf of demo users; end-user APIs cannot.

## 6. Timestamp choices

The assignment explicitly calls for `tsrange`. Therefore a scheduling timestamp represents an Asia/Kolkata wall-clock time. `campus_now()` converts the current instant explicitly to that zone. The API accepts offset-free strings, and the `pg` timestamp parser returns them as strings instead of converting them to JavaScript Dates using the server's local zone.

The frontend uses FullCalendar's Luxon named-timezone plugin and passes explicit `+05:30` event offsets for this single-campus policy. Audit timestamps are real instants (`timestamptz`). A multi-campus system should revisit the model with `tstzrange` and explicit equipment timezones; it is not claimed here.

## 7. Tests that substantiate the design

`database.test.js` tests the supplied migrations directly, including override rollback, mixed protected conflicts, adjacency, maintenance, usage, and cancellation races. `api.test.js` exercises the real Express routes, current-role enforcement, invalid dates, and simultaneous HTTP bookings. `concurrency.mjs` is a repeatable standalone demo with assertions, not a script that only prints responses.

The constraint-only test copies the actual reservation definition with `LIKE ... INCLUDING ALL`, confirms the copied exclusion constraint exists, and omits the workflow triggers. One connection holds a conflict uncommitted, a second attempts an overlapping insert, and the test observes a PostgreSQL lock wait before committing the first. Exactly one row remains. This demonstrates database enforcement independently of the per-equipment workflow lock.
