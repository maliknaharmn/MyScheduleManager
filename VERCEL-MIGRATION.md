# Full-stack Vercel Hobby migration (feature branch only)

## Owner-approved scope - 2026-11-19

- Move **both** React/Vite frontend and FastAPI API into one Vercel project.
  Keep the existing PostgreSQL 18 database on Neon Singapore (Free).
- Use only Vercel **Hobby**, native Python Functions and a static Vite build. Do
  not start Pro trials, add paid services/marketplace products, or change billing.
- Keep `https://myschedule.gwe.web.id`, existing Google callback, host-only Secure
  cookies, native owner password authentication, user IDs, sessions, RLS and history.
  Keep general password registration closed and Google identity login public.
- Work on **`infra/vercel-fullstack-migration`**. Commit/push and test previews from
  that branch only. **Do not push/merge `main` or perform production cutover until
  the owner approves the tested branch.** A `main` push auto-deploys FastAPI Cloud.
- Keep Netlify and FastAPI Cloud live and intact until the target is verified.
  No production user/agenda fixtures, invitation resend, password handling, or
  credential activation is part of hosting verification.

## Current state

- Vercel CLI `59.16.0` was browser-authorized. The existing workspace
  `maliknaharmns-projects` is active **Hobby**, with no trial. Unrelated projects
  were left unchanged.
- A separate `myschedule-manager` project was created:
  `prj_LocK85MCOpmhycrz1UZpncrdjJTd`. Its default function region is `sin1` and Node
  version is `24.x`. No domain cutover has occurred. The initial CLI deployment
  was unexpectedly classified Production and was removed, as detailed below;
  the owner then explicitly approved a **zero-secret empty bootstrap only** to
  initialize Vercel. This is not approval for an app Production deploy or cutover.
- Root `vercel.json` passes Vercel's published JSON Schema. It defines two Services
  under one deployment: native Python/FastAPI in `backend/`, static Vite in
  `frontend/`, with API/health routes evaluated before frontend routes. Vercel
  Services are **Beta on all plans**, so an actual Hobby build remains a required
  acceptance check, not something inferred from local configuration validity.
- `.vercelignore` narrowly includes application inputs and excludes private envs,
  local state, virtualenvs, tests, migrations, and the original local-preview backend.
  The old Dockerfile is excluded so Vercel does not choose a container runtime.
- Runtime Python requirements are compiled against the existing tested lock;
  frontend installation uses its existing `package-lock.json` and `npm ci`.
- Production still uses **Netlify + FastAPI Cloud + Neon**, with no DNS/API proxy
  switch or production schema migration. The production database remains `0002`.
- A disposable, parent-data Neon rehearsal branch was created in the same existing
  Free project, expiring **2026-11-21**. Only this branch was upgraded to `0003`.
  All existing table contents matched before/after using private SHA-256 fingerprints.
  Forced RLS and least-privilege runtime role readiness passed; production is untouched.
- Local checks currently pass **218 backend tests**, Ruff/formatting, frontend
  build, 52 frontend unit tests and 4 legal/static checks. An earlier full desktop/mobile
  E2E run passed **162/162**. An additional Node 24 run passed 160 and exposed two
  notes synchronization/conflict test failures; those remain under investigation
  and must not be hidden by automatic retries or a premature merge-ready claim.
  Their traces were preserved; an explicit single-worker reproduction of both
  cases passed 6/6 without application/test changes. This does not erase the
  original failure or establish a root cause. A complete Node 24 desktop/mobile
  run subsequently passed **162/162 with one worker and no retries**. The two-worker
  intermittency remains recorded; no notes behavior or test assertion was weakened.
  The three public policies name Vercel in this branch; the unchanged production
  publication still names its current providers until a reviewed cutover. Cloud build/runtime,
  browser results and any further checks must be recorded separately when completed.
- A repeat browser run exposed a test-only race: the save button was disabled before
  Playwright received the intercepted POST. The assertion now waits for that single
  request before releasing its held response; application mutation/retry behavior
  was not changed. The full desktop/mobile rerun passed **162/162**, with no retries.
- All 25 runtime variables are uploaded to **Preview only**, including 11 marked
  sensitive. No Production variables exist. The initial preview is in application
  maintenance with a one-off SMTP TLS/auth probe; no email has been sent.
- Six local production-build screenshots were opened at desktop/tablet/mobile in
  light/dark mode. These use mocked public readiness, not real account data or a
  claim that Vercel runtime routing or Google login has already passed.
- The first committed-source CLI upload dry-run caught directory exclusions before
  any deploy. Bare directory negations now allow Vercel's walker to descend into
  both application roots; the revised dry-run contains 121 expected inputs. Verify
  the final committed export again before deploying, including secret exclusions.

## Cloud build evidence and preview blocker - 2026-11-19

- Source commit `66d4b03` was exported from Git and checked against the exact CLI
  upload: 117 regular files (121 entries including empty directories), no secret
  files/values, test fixtures, migration-owner URLs or local-preview backend.
- The cloud build completed successfully on Hobby. Deployment metadata confirmed
  a native **Python 3.13** function in **`sin1`**, with 2,048 MB memory and a 60-second
  timeout. This proves build/output placement, **not runtime readiness or login**.
- Despite explicitly passing `--target preview`, Vercel classified this project's
  first no-Git deployment as **Production**, and assigned only new `vercel.app`
  aliases. It was **not** connected to `myschedule.gwe.web.id`. Verification stopped
  when inspection found the environment mismatch; the unintended deployment and
  its aliases were removed. No app runtime probe or email was sent.
- Follow-up metadata confirmed **zero remaining deployments**, **zero custom
  domains**, all 25 variables still **Preview-only**, and no Production variables.
  Existing Netlify/FastAPI Cloud services, production Neon schema/data and DNS were
  unchanged. `main` and `origin/main` remain at `46403dde5bb2fd0a730276a92e4cceef89da66ca`.
- The build also showed the former open-ended frontend Node engine selecting 26.x
  despite the project's 24.x default. The frontend manifest and lockfile now pin
  **24.x**. Local build, 52 unit tests and 4 legal/static checks pass on Node 24.22.3;
  a subsequent cloud build on that version is still required.
- Vercel's official [environment documentation](https://vercel.com/docs/deployments/environments#first-deployment)
  confirms the first deployment is **always Production**, even with `--target=preview`
  or a non-production Git branch. It uses Production variables, so none of this
  project's Preview-only credentials were available. Deleting all deployments
  resets that first-deployment rule; connecting Git does **not** avoid it.
  **Do not blindly retry** the CLI, create a placeholder Production deployment, or
  treat `--skip-domain` as proof of Preview. A new deployment method needs owner
  review and explicit permission for a protected, zero-secret project bootstrap
  with no custom domain. Even a canceled/failed first deployment counts if retained.
  The owner subsequently selected **"Izinkan bootstrap kosong"**: an isolated static
  placeholder was deployed with no app source, secrets, database or custom domain,
  using `--skip-domain`. This is the sole approved Production-label exception;
  application production cutover and `main` merge remain separate approvals.
  Retain this empty initialization deployment so the first-deployment rule does not
  reset again. All application deployments still require a verified Preview target.
- App deployment `dpl_J1T2vs3Dbd2Pgp77q3DYFSf3KKrS` from `0342f6e` was explicitly
  inspected as **Preview**, not Production. Native Python 3.13 in `sin1` loaded
  successfully; `/health/live` and `/health/ready` returned **200/no-store** against
  rehearsal schema `0003` and limited roles. Anonymous requests remained protected
  by Vercel (302); authenticated automation access does not create an app session.
- The first real routing probe caught 404s for `/` and trailing-slash policy paths,
  despite the actual HTML files and SPA deep links working. Explicit root/policy
  index rules now precede the frontend filesystem handler. Reverify in the next
  cloud build rather than treating a local schema test as sufficient.
- The startup SMTP diagnostic used a host-specific logger at INFO and was not
  observable in Vercel's runtime logs. Its opt-in, value-free diagnostic now uses
  an application logger at WARNING, regression-tested for both success/failure
  without mail or credential output. The real TLS/auth result is still pending.
- A private automation bypass was generated with protection still on. Vercel
  requires one such token to be its managed `VERCEL_AUTOMATION_BYPASS_SECRET`; it
  cannot be unset while it is the only token. It was not added as an application
  env entry: the project still has exactly 25 Preview-only app variables and no
  Production app credentials. The token is never a substitute for app auth and
  must stay out of Git, browser assets, command arguments and published links.
- SMTP TLS/auth, corrected static routes and anonymous OAuth/CSRF still need their
  remaining cloud acceptance checks. Do not merge or migrate production yet.
- A final read-only check of the unchanged public site returned **200** for Welcome,
  readiness and status; its database was ready and its original in-memory OAuth
  mode remained active. No login, password, mail or application-data writes occurred.

## Required serverless OAuth change

The original API's Google handshake state lives in one process. Vercel can route
the start and callback to different instances, so keeping that design would cause
login failures even with one configured region.

- Additive migration `0003` creates only `app_private.oauth_handshakes`. It does
  **not** rewrite users, credentials, sessions, agendas or any existing table.
- State/browser-binding lookup values are hashed. Nonce, PKCE verifier and return
  path are authenticated-encrypted using a domain-separated key from the existing
  session secret. No replayable OAuth payload is placed in a browser cookie.
- The auth role gets SELECT/INSERT/DELETE, not UPDATE. App/worker/PUBLIC are denied;
  RLS and FORCE RLS remain on. Allocation is globally bounded and serialized with
  a transaction lock; expiry and atomic DELETE/RETURNING enforce single use.
- `OAUTH_STATE_STORAGE=postgres` enables shared storage. The Vercel entrypoint
  refuses memory mode. Default memory mode remains available **only** for the
  original single-worker API's compatibility rollout before cutover.
- Readiness accepts reviewed revisions `0001`/`0002`/`0003` as appropriate and
  requires `0003` plus the auth table when shared state is enabled.
- Cross-instance consume, concurrent replay, wrong browser binding, capacity,
  expiration, corrupted ciphertext and restricted grants are regression-tested
  against isolated local PostgreSQL. No real Google token or account is used.

## Preview guardrails

1. Deploy only an isolated committed export of the feature branch, not the dirty
   original working tree. Keep Git automatic deployment off during migration.
2. Preview runtime uses the disposable Neon branch, never the production database.
   Migration-owner and test URLs stay local and are excluded from runtime inputs.
3. Preserve the existing Google client/session secret and native owner binding,
   but initially set application maintenance on. Do not complete real Google login
   on an unregistered preview callback. Keep the canonical production callback;
   cancelled/mock-provider flows can verify binding without creating sessions.
4. Vercel project deployment protection is `all_except_custom_domains`. Keep preview
   protection on and inspect through authenticated tooling or a private automation
   bypass. Never publish that bypass secret or treat it as application login.
5. Vercel leaves SMTP submission port 587 open. Test the existing Brevo STARTTLS
   TLS/auth probe from the Python runtime **without sending an email**. Keep mail
   awaited inside a request. If this fails, stop before production and decide on
   Brevo HTTPS; the missing API key from the abandoned Render plan is not silently
   replaced by the SMTP password. Disable the one-off probe after validation.
6. Verify actual deployed function placement, Python native dependency loading,
   readiness, maintenance 503/no-store, API errors, frontend/assets and legal-page
   routing. Then test anonymous gating/CSRF, shared-state cancellation and replay
   only against the isolated branch. Never test an invitation/reset by sending mail.
7. Check built frontend assets for secret values, and inspect desktop/tablet/mobile
   in both themes. Keep screenshots/reports local. Do not claim real owner Google/
   native login or authenticated-save latency from anonymous or mocked tests.
8. Rehearsal data expires with the disposable branch. Refresh deliberately if the
   review outlasts the expiry; do not point a production deployment at this branch.

## Later, after owner review and explicit merge/cutover approval

1. Merge the tested compatibility code only after approval, and verify FastAPI
   Cloud's automatic deployment accepts schema `0003` while still using memory
   state and the existing SMTP settings. Do not run migrations during API startup.
2. Take a private rollback/readiness record and rehearse any remaining schema steps.
   Apply additive `0003` to production only during the approved controlled sequence,
   after the original API is compatible. Retain existing rows and role grants.
3. Configure a Vercel production deployment with **production** limited Neon role
   URLs (not the rehearsal database), shared OAuth state, existing identity/secrets,
   and a verified mail transport. Keep it gated until ready. Never expose secrets
   with `VITE_`/`NEXT_PUBLIC_` or upload an entire private env file.
4. Add/verify the current custom domain with Vercel and prepare its exact returned
   DNS record. Cloudflare currently hosts DNS for `gwe.web.id`; no DNS API credential
   is available to this session. Owner DNS action will be needed. Do not change
   nameservers, the apex, other subdomains, MX or email verification records.
5. Enable source maintenance, drain in-flight requests, then coordinate target
   ungating and only the `myschedule` DNS record switch. Keep Netlify/FastAPI Cloud
   alive but the old API gated while DNS caches converge. No database copy is needed.
6. Verify public HTTPS, domain/callback/cookies, frontend deep links/legal pages,
   native CSRF/closed signup and private no-store behavior on the real domain.
   Have the owner complete actual Google/native login and confirm unchanged data.
7. Separate cold/warm timings. Free compute/database quotas and cold starts remain;
   this is not an uptime or sub-second performance guarantee. If correcting a
   published cutover, pause/drain first and fix forward without deleting old services.

References: [Vercel Services](https://vercel.com/docs/services),
[Services pricing](https://vercel.com/docs/services/pricing),
[FastAPI](https://vercel.com/docs/frameworks/backend/fastapi),
[Hobby](https://vercel.com/docs/plans/hobby),
[SMTP](https://vercel.com/kb/guide/serverless-functions-and-smtp).

## Free-plan budget boundary

Vercel's published Hobby allowances checked on 2026-11-19 include 4 active CPU-hours,
360 GB-hours provisioned memory, 1 million function invocations and CDN requests,
100 GB fast data transfer and 10 GB fast origin transfer per month. Services share
the normal function allowances; no service bindings, daemon, paid storage, analytics
add-on or Observability Plus is required here. Hobby has no paid overage budget:
limits can pause features until their reset rather than authorize an upgrade.
Do not add synthetic keep-alive traffic, buy extra capacity or promise uptime.
Existing Neon Free and Brevo allowances remain independent limits.
