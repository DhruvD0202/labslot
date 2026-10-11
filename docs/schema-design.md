# Schema rationale and normalization

## Scope and functional dependencies

The logical domain has six tables. Every row has a primary key, but a surrogate ID alone does not prove 3NF. The justification is based on the following meanings and dependencies.

| Relation | Keys and dependencies | Why the remaining attributes belong here |
| --- | --- | --- |
| users | `id` and normalized unique `email` are candidate keys. Either identifies name, password hash, current role, active state, and creation time. | Account facts are not copied into reservations. |
| equipment | `id` and `asset_tag` are candidate keys. Either identifies name, type, current location, description, and operational state. | One independently bookable asset; no repeating asset lists. |
| reservations | `id` identifies equipment, optional borrower, kind, immutable interval, reason, explicit override reason, creation time, and current allocation status. | Both booking and maintenance are allocations of an asset for an interval. |
| waitlist | `id` identifies one exact-interval request, borrower, equipment, reason, submission time, and lifecycle state. | Demand is distinct from an allocated reservation. A partial unique index additionally disallows identical simultaneously waiting requests. |
| usage_logs | `id` and unique `reservation_id` are candidate keys. Each identifies actual start/end and notes. | Actual use is a different fact from planned time. There is at most one usage session per booking in the MVP. |
| reservation_events | `id` identifies one action, timestamp, actor, reason, and relevant record references. | Multiple events can refer to the same reservation. Event facts do not overwrite prior events. |

Under these stated dependencies, fields are atomic within their domains (1NF), no non-key field depends on only part of a composite candidate key (2NF), and no non-key field is transitively determined by another non-key field (3NF). The active-request uniqueness condition is a conditional integrity rule, not a claim that the same interval can never be requested again historically.

We do not store current user role plus numeric role-derived priority on reservations, equipment labels alongside equipment IDs, or scheduled timestamps on usage logs. These are obtained through joins. A scheduling interval is stored as two endpoints; `tsrange` is an exclusion-index expression, not another independently editable stored field. Duration is derived.

## Why combine booking and maintenance?

Separate tables could each be normalized, but an exclusion constraint would not compare their rows with each other. A shared `reservations` ledger lets a single database constraint cover every occupied interval. A kind check enforces that bookings have a borrower while maintenance has none. Nullable subtype fields are constrained; their existence alone does not violate 3NF.

The filtered `bookings` and `maintenance_schedule` views provide familiar read models without duplicating data. Additional subtype tables can be added if either category grows many specific attributes, but they would require care to preserve exactly-one-subtype integrity.

## Values deliberately calculated when read

- **Availability:** operational state plus occupancy for an interval. `equipment.operational_status` records `active`, `out_of_service`, or `retired`, not `booked`.
- **Queue rank:** current user role, then queue time and UUID. A stored position would require renumbering unrelated requests after changes.
- **Upcoming/ongoing/past:** interval versus campus time. `reserved` means the allocation was retained; passing time alone does not mutate its status.
- **Expired waitlist requests:** the start time has passed, so they are omitted from active queue selection without a background expiry job.

These choices avoid update anomalies. A calculated value is not automatically a formal 3NF violation merely because it could be derived across rows or tables; the normal-form claim still depends on the relation's functional dependencies.

## Current roles and history

The policy intentionally uses current `users.role`. A role change can affect future override eligibility and queue ordering. It does not rewrite audit events. Reservations and waitlist requests preserve their own immutable interval/reason. Promotion creates a new allocation; the event links the request to that allocation. Displacement creates or reuses a waiting request and links it to the old and replacement reservations through an event. We avoid storing a source reservation ID alongside fields that would simply duplicate its immutable attributes.

The event reason is a fact about an action at a time. References identify that action's subjects; copying an action reason for the audit record is intentional historical capture. Current reservation status and transition events have different meanings, although they are updated atomically together.

Historical joins show current user names and asset labels. They do not claim to reconstruct an asset's old location or an actor's old name/role. If those historical meanings become required, introduce explicitly named snapshots or effective-dated records. Never silently treat a copy of a current value as a historical model.

## Type and location labels

Repeated labels such as `Microscopy` do not on their own violate 3NF. There are no type-dependent or room-dependent attributes in the equipment relation. Add an `equipment_types` relation if types acquire shared attributes such as descriptions or default booking limits. Add a `locations` relation if rooms acquire their own capacity, building, or manager. Keeping the MVP's labels simple avoids empty lookup-table machinery.

## Pricing is deferred

No billing values are part of this MVP. A later extension could introduce immutable effective-dated `equipment_rates` and a separate `booking_charges` relation referencing a reservation and its applied rate. Calculate estimates; store an agreed final charge only with its own financial meaning and adjustment rules. Do not duplicate a rate's equipment, amount, and currency into every booking, and do not recompute historical charges from today's rate. That future schema needs its own dependency review.

## Lifecycle and deletion

Foreign keys use restrictive deletion. Reservations, requests, usage, and events have deletion guards; events reject updates as well. Account deactivation and equipment retirement retain history. Rescheduling cancels an allocation and creates another. The application exposes no user role-management, equipment retirement, or destructive deletion endpoints yet; those are administrative tasks outside this MVP.

These controls apply to ordinary application SQL. A PostgreSQL owner/superuser can change constraints, disable triggers, or truncate data. Deployment privilege separation and backups remain separate concerns.
