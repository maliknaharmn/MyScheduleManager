# Railway Singapore migration - preparation, not a completed cutover

> **Superseded:** the current target is full-stack Vercel Hobby with existing Neon.
> Follow [VERCEL-MIGRATION.md](VERCEL-MIGRATION.md). The intermediate Render plan is
> retained in [RENDER-MIGRATION.md](RENDER-MIGRATION.md).
> This document records the earlier Railway plan, not authorization to provision it.

## Approved scope

- Move the FastAPI API and **PostgreSQL**, not Redis, into a separate Railway
  project in Singapore (`asia-southeast1-eqsg3a`). Do not reuse `malikkktest`.
- API sleeping is permitted to limit usage. Keep one replica and one API worker
  while OAuth handshakes are held in process memory. PostgreSQL needs persistent
  storage and stays running; do not put production data on an ephemeral filesystem.
- A temporary pause in login and data changes is approved **after** rehearsal and
  target verification. Keep Neon and FastAPI Cloud; deleting them is not approved.
- Keep Brevo, but use its HTTPS API on Railway Hobby because SMTP is blocked.
  Keep the existing SMTP implementation working for the original deployment.
- No subscription upgrade, billing-limit changes, password activation on the
  owner's behalf, new real-user fixtures, or new activation emails are approved.

## Current state (2026-11-17)

- Railway CLI `5.74.1` was authenticated by the owner. Workspace metadata reports
  Hobby, but `railway init` refuses provisioning with **"Your trial has expired.
  Please select a plan to continue using Railway."** The owner must resolve the
  billing state in Railway. Do not bypass that refusal or subscribe automatically.
- No migration project/service was created, no production data was copied, and
  no API/domain/proxy/environment cutover occurred. Existing resources stay live.
- Read-only source inspection confirmed the production runtime/owner URLs target
  the same database: PostgreSQL `180007`, schema `0002`, 18 application tables,
  about 8.7 MiB. Only the built-in `plpgsql` extension is installed.
- A local/private session secret was verified against the live password-CSRF HMAC
  without exposing any secret or reading private account payloads. The local Google
  client ID matches live OAuth start. Preserve these credentials and all user IDs.
- Brevo HTTPS requires a **Brevo API key**, not the SMTP password. The owner's
  local `.local/brevo-api-production.env` template is ignored and mode `600`.
  Never copy its value into documentation, shell arguments, frontend or Git.
- Backend preparation passes 197 tests, Ruff and formatting. A Docker engine is
  unavailable locally; no container build or Railway deployment is claimed yet.

## Prepared backend support

- `backend/Dockerfile` builds the existing locked Python 3.13 application, runs as
  a non-root user, and invokes `python -m myschedule.serve`. No automatic migration
  runs on API startup. `.dockerignore` uses an allowlist and excludes private files
  and the original working tree's local-preview backend.
- `PORT` is validated and bound on `0.0.0.0`; worker count is fixed to one even if
  `WEB_CONCURRENCY` is supplied. Access logs stay off to avoid OAuth query strings.
- `MAIL_TRANSPORT=smtp` remains the default. `brevo_api` uses a fixed verified HTTPS
  endpoint, plaintext content and fragment links, owner-only recipients, explicit
  acceptance checking, no redirects, automatic retries, SMTP fallback or body logs.
- `DATABASE_SSL_CA_PEM` configures a private database CA without disabling certificate
  or hostname checks. Both limited runtime roles receive it. Do not replace Neon's
  existing public trust with a Railway CA, or use `sslmode=require` as a substitute
  for verified TLS when a private CA is configured.
- `MAINTENANCE_MODE=true` rejects all non-health HTTP requests with 503/no-store and
  `Retry-After`, before authentication, queries, email or mutations. Health endpoints
  remain available for platform readiness checks. The flag defaults to false.

## Required sequence after the blockers are resolved

1. Confirm the intended workspace can provision without changing its plan. Use the
   CLI with explicit project/environment/service IDs; do not depend on the workspace's
   default US West region. Configure Singapore before deploying services/volumes and
   verify the actual deployed placement. API sleep permitted does not guarantee that
   it sleeps: open outbound/pool connections can keep Railway services active.
2. Use PostgreSQL 18, a persistent volume, and bounded resources. Determine and
   configure an ongoing backup policy before production cutover. Do not imply that
   a single volume or one migration dump provides high availability or PITR.
3. Create fresh least-privilege `myschedule_app`, `myschedule_auth`, and
   `myschedule_worker` roles plus a separate controlled migration owner. Never put
   the Railway-generated PostgreSQL administrator URL into API runtime settings.
4. Take a consistent, private direct-connection source dump with permissions `600`.
   Restore it into a new isolated rehearsal database. Preserve schema `0002`, RLS
   and FORCE RLS, policies/grants, constraints, account identifiers, password hashes,
   link hashes/expiry, sessions, versions, history and soft-deleted rows. Compare
   complete table contents privately; counts alone do not prove a correct restore.
5. Keep PostgreSQL private. Railway's maintained SSL image can issue a certificate
   covering its private hostname. Retrieve its **public CA certificate**, not its
   private keys, through authenticated administration and configure verified TLS.
   Any temporary external database access must be secured and removed before cutover.
6. Build/deploy the API from an isolated committed export, never the older dirty
   working tree. Whitelist runtime settings: current public origin/callback, existing
   Google/session/owner identity, limited target connections and Brevo sender/API
   secret. Do not upload source migration credentials, test URLs or the whole `.env`.
7. Validate target readiness, limited-role/RLS isolation, anonymous gating, session
   compatibility, Google state/PKCE/cookies, native CSRF and closed general signup.
   Verify Brevo API authentication and approved sender without sending a real
   activation/reset invitation. SMTP probes must be off for the HTTPS transport.
8. Deploy maintenance-capable code on the **existing** source API with maintenance
   still off. Only after the target rehearsal passes, enable source maintenance,
   drain in-flight work and verify all old direct/proxied API paths reject writes
   and logins. A frontend-only banner is not a sufficient write freeze.
9. Make a final consistent source dump while writes are paused. Restore to a fresh
   final target database and compare contents/security again. Do not restore over
   a target that has already accepted new production writes. Point target runtime
   roles at this final database and check readiness before changing the proxy.
10. Update only Netlify's API/health proxy targets to the verified Railway HTTPS
    service; preserve `https://myschedule.gwe.web.id`, callback path, host-only cookies,
    existing Masuk/Buat akun UI and private-data `no-store`. Update transport wording
    in public policy if it still specifically promises SMTP, without changing the
    processor or unrelated policy terms.
11. Verify publication, real-browser anonymous flows and public pages, and have the
    owner verify real Google/native login and unchanged account data. Measure cold
    versus warm reads/saves separately; API sleeping means cold latency remains.
12. Keep the old source API in maintenance to avoid two writable primaries. After
    Railway accepts new writes, pointing the proxy back at the old database would
    lose those writes: any reversal requires another pause and data reconciliation.
    Keep the old resources and backups until the owner approves their retirement.

References: [Railway regions](https://docs.railway.com/reference/regions),
[SMTP restrictions](https://docs.railway.com/networking/outbound-networking),
[private networking](https://docs.railway.com/networking/private-networking),
[volume backups](https://docs.railway.com/volumes/backups),
[Brevo transactional HTTPS API](https://developers.brevo.com/docs/send-a-transactional-email).
