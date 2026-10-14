# Verification record

Initial verification: **11 October 2026**.

Environment: Windows x64, Node.js 22.19.0, local PostgreSQL 18.4 from `embedded-postgres`, real TCP connections. Vite 6.4.4 production build. Dependencies are pinned through `package-lock.json`.

| Check | Observed result |
| --- | --- |
| `npm test` | 22 passed, 0 failed, 0 skipped |
| `npm run test:concurrency` | 20 concurrent HTTP requests; 1 confirmed; 19 HTTP 409 slot conflicts; 1 stored reservation |
| Constraint-only database race | Observed the second PostgreSQL backend waiting on the first uncommitted insertion; after commit, second insertion returned `23P01`; one row remained |
| `npm run check` | JavaScript syntax checks passed |
| `npm run build` | Vue/FullCalendar production bundle built successfully |
| `npm run test:production` | Built HTML and JavaScript served through Express; script policy present; database health connected |
| Local API readiness | `/api/health` returned database connected |
| Browser student flow | Signed in, observed a real overlap conflict, created a free-interval booking, and cancelled it |
| Browser faculty flow | Created a justified override, observed displacement/audit events, then cancelled and observed the student's promotion |
| Responsive layout | Checked desktop and 390 px mobile viewport; mobile day view had no horizontal page overflow |
| Calendar keyboard interaction | Enter on a calendar reservation opened its details dialog |

The 22 automated cases cover authentication and student-only registration; stale JWT roles and inactive users; concurrent HTTP bookings; conflict responses and cancellation ownership; calendar timezone serialization; faculty-only endpoints; adjacency/nesting; booking/maintenance conflicts in both directions; multiple student displacements; protected mixed conflicts; the exact 24-hour boundary; inactive equipment; rollback after trigger side effects; priority promotion; full-interval eligibility; cancellation rollback; concurrent cancellation; override racing promotion; uniqueness, range and FK checks; history protection; usage lifecycle; and the independent EXCLUDE blocking test.

Tests create and remove their own schemas. The domain data shown in the demo is not reset by the test suite. The test clock is controlled only within each test schema; production clock logic is unchanged.

Screenshots from the running app: [equipment schedule](screenshots/schedule.png), [activity trail](screenshots/activity.png), [mobile day view](screenshots/mobile.png). Browser verification leaves its cancelled/displaced records in the normal audit history; the original student's interval was restored through promotion.

## Hosting preparation - 15 October 2026

The Render/Neon configuration was checked locally on Windows x64 with Node 22.19.0 and real PostgreSQL 18.4. All **25 automated tests passed**, with no failures or skips. The three additional cases cover real hosted startup into a disposable empty schema, idempotent migration/seeding and preservation after restart, per-client sign-in rate limits behind a configured proxy, and rejection of malformed proxy settings.

`npm run check`, the production build, and the production-serving smoke check passed. The standalone concurrency check again produced **20 simultaneous HTTP requests, 1 confirmation, 19 conflicts and 1 stored reservation**. Test schemas were removed; the normal local demo records were preserved.

A Neon PostgreSQL 18 project was created in AWS Singapore. This is provisioning evidence only: the hosted app, Neon migrations, cloud proxy topology, and a public website URL are **not yet verified**. Local startup and proxy checks do not replace those live checks. The [deployment guide](deployment.md) lists the checks needed before claiming the app is deployed.

## Limits of these results

- This demonstrates the tested correctness scenarios, not unlimited throughput, a full load test, or a proof covering every possible transaction interleaving.
- Live deployment, cross-host behavior, backups/recovery, and production privilege separation have not been verified.
- A raw database owner can bypass application policy and alter triggers; audit history is not tamper-proof against that owner.
- Account-role/equipment-status administrative changes during a scheduling transaction are outside the exposed MVP workflows.
- No email notifications, password reset, refresh tokens, billing, recurring bookings, pooled capacity, or multi-campus timezone support.
- Seeded dates are relative to the first run. An older persistent demo may show past sample sessions; create new bookings rather than expecting restart to reset history.

See README for commands to reproduce the checks, and rerun them after changing SQL or workflow code.
