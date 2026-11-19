# Render Free Singapore API + existing Neon database

> **Superseded 2026-11-19:** the owner selected full-stack Vercel Hobby instead.
> Follow [VERCEL-MIGRATION.md](VERCEL-MIGRATION.md). This is a historical plan;
> Render's payment-information refusal was not bypassed and no service was created.

## Approved scope (2026-11-17)

The owner replaced the Railway migration with a **free-tier-only** plan:

- Move only the FastAPI API to Render Free in `singapore`, one instance/worker.
- Keep the existing PostgreSQL 18 database on Neon in `aws-ap-southeast-1`.
  No new database, data dump/restore, schema migration, user/role recreation or
  database credential rotation is needed or authorized for this hosting move.
- Keep the current Netlify frontend, `https://myschedule.gwe.web.id`, Google
  callback, immutable user IDs, RLS boundaries, sessions, and owner password auth.
- Keep Brevo; use its HTTPS API because Render Free blocks outbound SMTP too.
  Do not resend invitations, activate credentials, handle owner passwords, or
  create synthetic production users/agendas while testing the hosting move.
- No paid compute, disks, databases, previews, cron jobs, trials, plan upgrades,
  payment-method changes, or workspace billing-limit changes. Leave Railway alone.
- Retain the previous API and database. Pause login/writes only for a verified
  target cutover; do not delete the FastAPI Cloud service.

## Verified status

- Production still uses Netlify -> FastAPI Cloud -> Neon. `netlify.toml` has not
  been switched, and no database/schema change has been performed.
- Render CLI `2.34.0` is installed and browser-authorized by the owner. The selected
  workspace is `My Workspace` (`tea-dbtu9guk1f9s739par80`), currently with zero services.
  No API deployment is claimed until an actual Render build and runtime checks pass.
- The production Neon project `purple-butterfly-48151142` is in Singapore, uses
  PostgreSQL 18, and belongs to an organization on **Free**. The existing source
  read-only preflight found schema `0002`, 18 tables and approximately 8.7 MiB.
- Netlify's existing team is **Free** (`credit-free`), with auto-top-up off, no
  Stripe payment method, no active paid trial and overages disabled. Git continuous
  deployment remains disconnected; a frontend cutover needs explicit publication.
- The Render public workspace API does not expose billing plan, payment-method or
  overage settings. The owner confirmed **Hobby ($0) with no payment method** in the
  [billing dashboard](https://dashboard.render.com/billing). Nevertheless, remote
  Blueprint validation returns **`need_payment_info`**, even with explicit Free
  compute. Provisioning is stopped, as agreed; do not add a card, start a trial,
  create a service through another route to bypass the refusal, or claim success.
- The owner directed API-key loading to the existing private
  `/Users/muhammadmalikn/MyCalender Manager/.local/brevo-production.env`. Its permissions
  are `600`, but it contains only SMTP settings and **no `BREVO_API_KEY` entry**.
  Add a separate `BREVO_API_KEY=` entry privately while preserving all SMTP values.
  Never substitute the SMTP password, paste an API key into chat, or turn password
  authentication off to deploy. No Brevo API call or email was made in this preflight.
- `render.yaml` is an API-only preparation: explicit `plan: free`, `region:
  singapore`, manual deploys, previews off, no disks/databases, existing-secret
  prompts, and application maintenance initially on. It is not a completed deploy.
- Local Docker is unavailable. Python/unit/integration checks do not prove that a
  Linux container builds or that a cloud provider accepts the configuration.
- All **201 backend tests**, Ruff and formatting pass. The Blueprint passes Render's
  official JSON Schema locally. Remote validation is **not passed**: besides the
  payment-information refusal, the explicit hosting branch is not yet published.
  Changes stay uncommitted/unpushed on local `infra/render-free-singapore`; do not
  push `main` or switch the proxy while these blockers remain.

## Free-tier limits and cost guardrails

- Render Free sleeps after 15 minutes without inbound traffic and can take about
  one minute to wake. There are 750 free instance hours per workspace/month.
  Netlify's proxy/browser may time out before a cold API wakes; verify the existing
  unavailable/retry flow and measure cold and warm behavior separately. Do not add
  artificial keep-alive pings or promise consistently sub-second loading.
- Render describes Free instances as unsuitable for production guarantees. They
  can restart or be suspended at limits. This is a budget-first personal-app choice,
  not an uptime/SLA or speed guarantee.
- Builds and outbound traffic have separate allowances. Without a payment method,
  Render suspends services or stops builds instead of buying overage. Do not add a
  card or approve supplemental usage to keep the app running at a limit.
- Free Render PostgreSQL expires after 30 days and has no backups. **Do not create
  one**. Keep all durable application data on the existing Neon database instead.
- Neon Free is not a trial but has compute, storage and transfer quotas. Hitting
  them can suspend compute or block writes. Check current usage before cutover;
  do not upgrade, migrate or silently change org/compute policies to bypass a limit.
- Retain small pooled, limited-role connections and public certificate/hostname
  verification for Neon. Do not configure `DATABASE_SSL_CA_PEM` for this target.
  Do not upload migration-owner, worker, test or unrelated local credentials.
- Brevo's existing account allowance still applies independently. Validate its API
  key/account plan and approved sender read-only; do not send an activation/reset
  email as a connectivity test or purchase email credits.

## Guarded deployment and cutover

1. Confirm Render's free/no-card billing guard and receive the private Brevo API
   key. Check `/v3/account` and `/v3/senders` with verified HTTPS and no redirects;
   keep responses/keys private and do not call the send endpoint during preflight.
2. Run backend tests, lint/format checks and Blueprint validation. Publish only the
   isolated hosting branch, not `main` (which still auto-deploys FastAPI Cloud).
   Keep auto-deploy and Blueprint auto-sync off to avoid surprise source changes.
3. Before creation, list existing Render services and refuse a duplicate name or
   wrong workspace. Explicitly set free/Singapore/one instance/backend Docker root.
   The checked-in Blueprint and actual service settings must agree. Never let the
   platform select its paid default plan or attach any persistent disk/add-on.
4. Build from the approved committed source, not the older dirty working tree.
   Pass only whitelisted runtime settings and existing identity secrets through
   secret inputs, never command arguments, Git, Docker layers or log output. Keep
   native auth enabled, Google configured and `MAINTENANCE_MODE=true` on the target.
5. Verify the actual live service's plan/region/commit, Linux build, limited-role
   database readiness and 503/no-store maintenance gate. Health checks are read-only.
   Do not point Netlify to a partially configured API or test production account
   creation, password reset/activation, session creation or agenda writes.
6. After target validation, deploy maintenance-capable source API code with its
   current SMTP configuration and maintenance initially off. Enable source
   maintenance, drain in-flight requests, and verify old direct/proxied paths block
   login and writes. The database remains the **same** authoritative Neon database;
   there is no final dump, restore or data reconciliation between separate copies.
7. Verify target anonymous auth/CSRF/closed signup without sending mail or creating
   sessions, then change only the Netlify API/health proxy to the verified Render
   HTTPS hostname. Keep public origin, callback, host-only Secure cookies and
   private `no-store` behavior. Publish from isolated committed source. Update public
   policy transport wording if it specifically says SMTP instead of Brevo email.
8. Confirm the target is out of application maintenance, the old API stays gated,
   and the deployed frontend/health/auth behavior is correct. Have the owner test
   real Google/native login and unchanged data. In-memory OAuth attempts in progress
   may need restarting after the API switches or sleeps.
9. Measure first-wake and warm latency independently. If a published cutover needs
   correcting, pause/drain APIs first and fix forward with a new verified proxy
   deployment. Because both APIs use the same Neon database, there is no stale
   database copy, but still avoid ungated parallel backends and in-flight requests.
10. Keep FastAPI Cloud and Neon resources intact. Do not treat this move as approval
    to delete old services, downgrade unrelated accounts, or change subscriptions.

References: [Render Free](https://render.com/docs/free),
[regions](https://render.com/docs/regions),
[Blueprint reference](https://render.com/docs/blueprint-spec),
[Neon Free plan](https://neon.com/pricing).
