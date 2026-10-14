# Host the portfolio demo on Render and Neon

Live demo: **[labslot.onrender.com](https://labslot.onrender.com)**. The deployed booking, conflict, override and waitlist-promotion workflow was verified on **15 October 2026**. See [verification](verification.md) for the exact scope. Use free plans for this class demo. No billing upgrade is required by this configuration.

The Vue bundle and Express API run together as one Render web service. Neon stores the actual PostgreSQL tables, constraints, functions and triggers. This uses the existing application, not a static mock-up. The database is separate from Render's temporary filesystem.

## 1. Create the database

1. Sign up at [Neon](https://neon.com) using your own account, and choose the Free plan.
2. Create a project named `labslot`. Choose a supported PostgreSQL version, preferably 18, and an AWS Singapore region if available. The application requires PostgreSQL 16+ and `btree_gist`.
3. Use the project's connection dialog to choose a **direct, unpooled** connection to its database. Copy its PostgreSQL connection string privately. This same connection is used for migrations and the small demo's API pool.
4. For this project's `pg` driver, use `sslmode=verify-full` in the URL. Retain other provider-supplied parameters, including `channel_binding=require` when supplied. Do not disable certificate verification.

The app creates `btree_gist` through its migration. The Neon database owner must be allowed to install this supported extension. Do not paste database passwords, connection strings or the JWT secret into GitHub, chat, or frontend variables.

## 2. Create the web service

The checked-in `render.yaml` contains one explicitly **Free** service. It does not create a paid database or disk.

1. Sign up at [Render](https://render.com) using your own account.
2. Connect the `DhruvD0202/labslot` GitHub repository. Select the branch containing `render.yaml` and `scripts/start-hosted.mjs`.
3. Create a **Blueprint** from that branch. Review the service and confirm its plan is **Free**.
4. Supply the Neon connection string as the private `DATABASE_URL` environment variable.
5. Apply the Blueprint and wait for the deployment to finish. Open the actual `.onrender.com` URL Render returns.

If configuring a Web Service manually, use these settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Plan | Free |
| Region | Singapore, preferably near the Neon database |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm run start:hosted` |
| Health check | `/api/health` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `DATABASE_URL` | Private Neon direct connection string with verified TLS |
| `JWT_SECRET` | Random secret of at least 32 characters; Blueprint generates it |
| `TRUST_PROXY_HOPS` | `1` initially; verify against the actual hosted proxy path |
| `VITE_DEMO_MODE` | `true` at build time |
| `SEED_DEMO` | `true` |
| `DEMO_PASSWORD` | `LabSlot-demo-2026!` for the deliberately shared demo accounts |

Render supplies `PORT`. The package's Node engine range selects the latest matching Node 22 release. Frontend requests use the same origin, so no separate API URL or CORS setup is needed.

The current deployment was created as a Web Service with the settings above. Its `DATABASE_URL` and `JWT_SECRET` are stored in a private Render `.env` secret file, which Render makes available to this Node service. The application loads it with `dotenv`; the values are absent from GitHub and the frontend bundle. The Blueprint is an alternative reproducible setup that supplies the same values as private environment variables.

Free Render services do not provide a pre-deploy command. `start:hosted` checks for the built app, applies checksum-verified migrations, optionally seeds demo records, and only then starts Express. A failed preparation step stops startup rather than accepting requests against an incomplete schema. Restarting preserves existing records and passwords. New deployment secrets do not belong in `.env.example` or `render.yaml`.

## 3. Verify the deployed site

Before claiming a working hosted demo:

- Open the returned URL and confirm the login page loads with its styling and calendar bundle.
- Open `/api/health` on that same domain. It should return `status: ok`, `database: connected` and `timezone: Asia/Kolkata`.
- Sign in with both shared demo roles. Confirm that student and faculty see the correct controls.
- Complete the [class demo](demo-guide.md): create a future booking, reject a duplicate, override as faculty, then cancel and observe promotion.
- Confirm activity events are recorded and the restored student booking is visible after refreshing the page.
- Check Render logs for database, proxy-header or rate-limit configuration errors. Verify the client-address proxy path before increasing `TRUST_PROXY_HOPS`; never use unrestricted `trust proxy: true`. Local tests cover a one-proxy path, not Render's eventual network topology.
- Restart or redeploy the service and check the records remain. Do not run the integration suite against this shared hosted database; use local PostgreSQL or a dedicated test database.

The public portfolio demo intentionally gives visitors access to shared fictional student and faculty accounts. Use fictional data. Anyone with those accounts can perform their normal demo actions. This is not a private university system. For real accounts, turn off both demo flags, provision faculty separately, use a restricted runtime database role, and add tested operational controls.

## Before class

Open the live site a few minutes before presenting. Render's Free service sleeps after inactivity and can take about a minute to wake. Keep the local `npm run demo` option available in case classroom internet is unavailable. Neon and Render each have their own free-plan usage limits. Do not select an upgrade or enter billing details unless you choose to pay.

## References

- [Render Free services and limits](https://render.com/docs/free)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render Node version selection](https://render.com/docs/node-version)
- [Neon PostgreSQL extensions](https://neon.com/docs/extensions/pg-extensions)
- [Neon application connections](https://neon.com/docs/connect/connect-from-any-app)
- [Express proxy configuration](https://expressjs.com/en/guide/behind-proxies/)
