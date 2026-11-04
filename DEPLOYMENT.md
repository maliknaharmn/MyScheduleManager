# Netlify frontend + FastAPI Cloud backend

Production frontend: **https://myschedulemanager.netlify.app**.
Dashboard: https://app.netlify.com/projects/myschedulemanager.
Created via authenticated CLI; Git continuous deployment is not connected yet.
Latest production deploy ID: `6ae5c162e89b7a8e8b6117d7` (bottom cookie-consent bar, 2026-10-31).
Static homepage/branding deploy ID: `6ae5bb8d2407182b6dd86f30` (2026-10-31).
Homepage ownership-tag deploy ID: `6ae335f6462dd1c3e6bcdc06` (2026-10-29).
Public legal/cookie release deploy ID: `6ae307e299941b4da528f2e9`.
Initial deploy ID: `6ae21772a5f42aa95f4f02eb`.
The owner changed visibility to Public; anonymous HTTP and browser checks now
reach the application successfully.

New projects in this team default to Private. Before public testing, the Team Owner
must open Project configuration → General → Visitor access → Project visibility,
Edit/Customize → **Public** → Save. The dashboard link is
https://app.netlify.com/projects/myschedulemanager/configuration/general/#project-visibility.
Netlify's perimeter login is separate from the application's Google login. Making
the gateway public does not remove account ownership or app authentication.

## Architecture

- React/Vite is a static Netlify deployment, built from `frontend/` using Node 24,
  `npm run build`, and publish directory `dist`. `frontend/package-lock.json`
  controls dependency installation. Repository-root `netlify.toml` is authoritative.
- FastAPI remains at `https://myschedulemanager.fastapicloud.dev`.
- Most recently inspected backend deployment: `14e1cddb-e69b-4014-b4a5-b9786b59486b`
  (2026-11-02; source commit `b9e5aaf`). Local performance changes require a new deployment.
- Browser requests stay on the Netlify origin: `/api/*` and `/health/*` proxy to
  the same paths on FastAPI Cloud. React Router's SPA fallback comes last.
- OAuth and session cookies are host-only (no explicit Domain), HttpOnly, Secure
  in production, SameSite=Lax. They belong to the public frontend domain because
  callbacks go through the proxy. Do not point client fetch at the backend domain
  or add cross-origin cookie workarounds.
- API responses, errors and auth redirects must retain backend `Cache-Control:
  no-store`. Netlify static headers do not override proxied response headers.

## First deployment

1. Authorize Netlify CLI and select/create the site in the intended team. Local
   `.netlify/` state is ignored by Git. Never commit a Netlify token.
2. For Git continuous deployment, connect `maliknaharmn/MyScheduleManager`, branch
   `main`, with root `netlify.toml`. A Git deploy uses committed code only; local
   public-signup/backend changes do not reach FastAPI Cloud until pushed and redeployed.
3. To upload the current local frontend instead, run these from the repository
   root after linking (the explicit directory avoids CLI monorepo path ambiguity):

   ```sh
   netlify build --context production
   netlify deploy --prod --no-build --dir frontend/dist
   ```

   The next production-branch push replaces a manual deploy if Git CD is enabled.
4. Use the resulting stable `https://<site>.netlify.app` domain for auth. Preview
   and deploy-permalink domains are not separate authorized login environments.
   Do not rely on login from previews when the backend is configured for production.

## Performance on the existing Hobby hosting

- Keep FastAPI Cloud Hobby, minimum 0 / maximum 1 replica. Always-on, paid upgrades,
  provider migration and a stack rewrite are not part of the approved first pass.
  Cold starts remain a limitation; separate idle/cold measurements from warm latency.
- The inspected API runs in `us-east-1`; the existing Neon database is in
  `aws-ap-southeast-1` (Singapore). The currently exposed Cloud app-create/update API
  has no region setting. Setting `AWS_REGION` in the Python environment does not
  move the application. Confirm Singapore availability with FastAPI Cloud support
  before treating relocation as an available configuration option. Migration is a
  last resort after measuring the optimized application, not a default requirement.
- Runtime pools reuse TCP/TLS connections with defaults `DATABASE_POOL_SIZE=2`
  and `DATABASE_POOL_MAX_OVERFLOW=1` per role/process (6 maximum client connections
  across app/auth with one worker). Keep separate limited roles, verified TLS,
  transaction-local RLS context, pre-ping and bounded pool waits. Migration
  connections remain direct/unpooled and are not used by API requests.
- Public `/status` probes are deduplicated and reused for at most 5 seconds per
  process; database errors invalidate that result. `/health/ready` still runs the
  complete live role/schema/connection check on every request. API responses remain
  `no-store`; there is no shared HTTP cache for account data or session validity.
- Identity and public status requests start together. Initial loading still gates
  access, but a background status refresh does not disable a ready sign-in link.
  The visible week loads first; four future weeks are prefetched after it renders.
  Writes remain server-confirmed and never retry automatically.
- `Server-Timing: app;dur=...` exposes only total application milliseconds, not
  SQL or account information. Measure browser request time, application duration,
  committed-save confirmation and cold/warm cases separately. Local tests and
  read-only pool checks do not prove production p95 below one second. Production
  verification requires deploying both components and measuring a real session
  without creating synthetic data in a user's account.

## Backend configuration after the domain exists

Set these **on FastAPI Cloud**, not in Netlify or browser-prefixed variables:

```dotenv
APP_ENV=production
APP_ORIGIN=https://myschedulemanager.netlify.app
GOOGLE_REDIRECT_URI=https://myschedulemanager.netlify.app/api/v1/auth/google/callback
COOKIE_SECURE=true
```

Keep the real Google client credentials, strong `SESSION_SECRET` (at least 32
characters), and limited-role `DATABASE_URL` / `AUTH_DATABASE_URL` on FastAPI Cloud.
Use `MIGRATION_DATABASE_URL` only for controlled migrations. Do not copy `.env`,
database credentials or Google secrets to Netlify, the public bundle, or chat.
`ALLOWED_GOOGLE_EMAILS` is obsolete once the public-signup backend is deployed.

Run a **single API worker/replica** while OAuth handshakes use process memory.
Disable access logging of OAuth query strings. Rebuild/redeploy after changing
backend settings or code. Production startup rejects missing security/database
configuration; readiness also checks roles and migrations, not only process liveness.

### Production readiness repair (2026-10-31)

- **Resolved:** `/health/ready` returns 200 both directly on FastAPI Cloud and
  through Netlify. Both `/api/v1/status` endpoints report `database: ready` and
  `google_login_configured: true`. Earlier 503 findings below are historical.
- **Actual cause:** the Cloud environment still contained the local development
  `DATABASE_URL` and `AUTH_DATABASE_URL`, targeting localhost / `myschedule_dev`.
  Ignored local Neon configuration is not uploaded to Cloud; a correct local
  readiness result did not mean the deployed environment had the same URLs.
- Replaced only those two connection values with the existing verified pooled
  Neon production URLs for `myschedule_app` and `myschedule_auth` / `neondb`.
  No owner credentials were used for runtime, and no schema, data, grants, role
  passwords, readiness checks or application source were changed.
- Preserved the Google credentials, session secret, HTTPS origin, callback and
  secure-cookie settings. Existing credential-bearing environment variables were
  recreated with identical values as encrypted secrets, except for the two
  deliberately corrected database URLs. Cloud secret types are immutable: an
  upsert on an existing regular variable does not convert it to a secret. The
  save-only replacement completed before redeployment; no secret values appear
  in this document or the verification reports.
- Reduced maximum replicas from 2 to 1 for the in-memory OAuth handshake store;
  minimum remains 0, preserving the existing scale-to-zero plan. Startup logs
  show one server process. Cloud rejected `WEB_CONCURRENCY` as a reserved name;
  it was not added. Shared durable handshake storage is still needed before
  multi-replica deployment. Idle scale-down/restarts can invalidate an in-flight
  login; restart the login flow rather than bypassing state checks.
- Redeployed the existing image from commit `e73e05a` as
  `d46799a0-6595-49f9-b0bb-a60f99071853`; Cloud reports `success`.
  No frontend redeployment, Git commit or push was needed for this repair.
- Live checks: readiness 200; anonymous `/me`, `/schedules` and `/notes` remain
  401 on both origins; all inspected API responses retain `no-store`. OAuth start
  returns 303 to Google with the production callback, identity-only scopes,
  nonce/state, S256 PKCE and a Secure/HttpOnly/host-only/SameSite=Lax cookie.
  An unbound callback and a replay are rejected; a correctly bound cancellation
  redirects safely without creating a session. External return URLs are rejected.
- Verification: 122 backend tests, Ruff, frontend production build, 25 frontend
  unit tests, 4 static/legal checks and 98 desktop/mobile Chromium E2E pass.
  Live desktop/tablet/mobile checks in light/dark confirm the Google sign-in
  link is active, with no private workspace shown before authentication, page
  overflow or JavaScript exceptions. Local audit artifacts were removed during
  the owner-approved documentation cleanup; these are historical results.
- **Still requires the owner:** complete real Google sign-in, then verify the
  resulting session, authenticated mutation, second-account isolation and logout
  in production. No Google account was signed in and no synthetic production
  user was inserted during this repair. Google Branding approval remains a
  separate, unverified provider-side process.

To prevent recurrence, set the runtime URLs on the existing Cloud app, not only
in local `.env` files. Never bulk-import `backend/.env` into production: it
contains local development/test targets. Keep both limited runtime roles,
verified TLS, and the existing readiness/migration checks; inspect the actual
deployed configuration before changing schema or provisioning a new database.

## Google Auth Platform

- OAuth client type: Web application.
- Authorized JavaScript origin: `https://myschedulemanager.netlify.app`.
- Authorized redirect URI: `https://myschedulemanager.netlify.app/api/v1/auth/google/callback`.
- Audience: External; publishing status: In production. Complete any branding,
  authorized-domain or verification requirements Google requests.
- Only `openid email profile` scopes are used for login. Calendar is not enabled.
- Branding homepage: `https://myschedulemanager.netlify.app/`.
- Branding privacy policy: `https://myschedulemanager.netlify.app/privacy/`.
- Branding terms of service: `https://myschedulemanager.netlify.app/terms/`.
- Public cookie policy: `https://myschedulemanager.netlify.app/cookies/`.
- Netlify deploy does not update Google Console or FastAPI Cloud settings for you.

### Homepage ownership verification

Google Auth Platform may report that the homepage is not registered to the project
owner. Verify the exact `https://myschedulemanager.netlify.app/` URL-prefix property
in Google Search Console using a Google account that is an Owner or Editor of the
OAuth project. The owner-supplied `google-site-verification` meta tag is stored
directly in `frontend/index.html` so it is present in the production HTML response
without JavaScript, login or API access. It is a public verification token, not an
OAuth client secret; do not move it into a client-side effect or remove it after
verification, because Google can check it again.

After deployment, confirm the exact tag in the live homepage source, click
**Verify** in Search Console, and wait **24 hours after successful verification**
before retrying the failed Branding check as instructed by Google. Installing the
tag does not itself confirm Search Console ownership or complete brand verification.
This process does not fix backend database readiness.

Tag deployment on 2026-10-29: live `/` returned HTML 200 containing exactly one
verification meta tag with the owner-provided value inside its static `<head>`.
All three policy URLs still returned 200. Production build, 24 unit tests,
3 static-document/ownership tests and 84 desktop/mobile E2E passed. Search Console
ownership and Google Auth Platform approval still require the owner's actions.

### Homepage purpose/name remediation (2026-10-31)

- The owner reports successful Search Console verification using the same account
  associated with the OAuth project as Owner/Editor. This is owner-confirmed, not
  independently inspected through the public verification tag.
- The original response contained an empty React root and a short no-script
  fallback; the full Welcome also waited for `/me`. The heading was a slogan and
  the mobile header hid `Manager`. These are observed crawlability/identity risks,
  not proof of Google's exact internal rejection reason.
- The deployed initial HTML now renders the shared public Welcome: exact app name
  in the heading and mobile brand, clear agenda/notes/checklist purpose, identity-only
  Google data use, operator/contact, illustration label and policy links. It is
  readable without JavaScript or the API. Client loading/failure states keep this
  information visible; the private workspace still requires a verified session.
- `netlify build --context production`, 25 unit tests, 4 static/legal tests and
  90 desktop/mobile Chromium E2E passed. E2E now uses the production build, including
  no-JS reading, blocked bundles and a stalled session check. Live HTTP confirms
  the public body, unchanged ownership tag, 200 policy pages, no `noindex` and no
  cross-domain homepage redirect. Live desktop/tablet/mobile checks in both themes
  and no-JS mobile found no overflow or JavaScript exceptions.
- During this initial homepage deploy, the Netlify badge intercepted pointer clicks
  on the mobile footer's cookie-settings button; keyboard activation still worked.
  The later bottom-bar update below adds badge-safe spacing without hiding the badge
  or changing the hosting setting.
- Retry **Verify Branding** with app name `MySchedule Manager` and the exact links
  listed above. If the same ownership/name/purpose findings remain, request manual
  review and attach a non-secret Search Console ownership-status screenshot and
  the homepage URL. If Google already emailed a verification case, reply there to
  confirm the homepage update and successful ownership verification. Manual review
  commonly takes 2-3 business days, not a guaranteed approval time. Publish branding
  only after the status becomes **Ready to publish**.
- No OAuth Console/IAM settings or backend configuration were changed in this
  homepage remediation. At that point database readiness was 503 / `not_ready`;
  it was subsequently repaired as documented above. Real hosted login and
  Google's approval remain unverified.

Official guidance: [Brand verification](https://developers.google.com/identity/verification/authentication-verification)
and [App homepage findings](https://support.google.com/cloud/answer/13807376?hl=en).

## Cookie bottom-bar update (2026-10-31)

- Following the owner's reference, the initial notice is a compact, full-width
  non-modal bar at the bottom of the viewport, not above the header. It has no
  backdrop, scroll lock or automatic focus. The hero and sign-in position do not
  shift when it appears or closes.
- A measured end-of-page spacer keeps the footer scrollable above the bar. The
  observer measures the border box so padding-only changes, resize, error text
  and host-badge clearance also update the reserved height.
- Reject, allow and granular settings remain available. The close button only
  dismisses the notice for the current mount; it stores no consent, enables no
  optional storage and does not prevent reopening settings through the footer.
- The Netlify badge is neither disabled nor concealed. When present, responsive
  spacing keeps cookie buttons clear of its hit area on mobile and desktop.
- Build, 25 unit tests, 4 static/legal tests and 98 desktop/mobile Chromium E2E
  passed. Live 1440/768/390/320px checks in light/dark verified bottom placement,
  an unchanged header position, a visible sign-in control, footer clearance,
  real pointer access to settings and closing without consent. Screenshots were
  opened during verification; local audit artifacts were later removed.
- The Google ownership tag, prerendered public identity/purpose, static legal
  documents, session gates and consent-storage semantics are preserved. No
  backend changes were made. The homepage and cookie-bar source changes are
  included together in the subsequent main-branch publication.

## Public legal/cookie release (2026-10-29)

- Owner approved publication with operator **MySchedule Manager**, contact
  **maliknahar.mn@gmail.com**, and manual email handling of data/account requests.
  Effective date is 29 October 2026. Policies disclose soft deletion and do not
  promise instant backup deletion or a server-side Terms-consent record.
- Vite builds the three policies as independent HTML entries. Their full text,
  section links and contact work without JavaScript, login or the backend.
  `/privacy`, `/terms`, `/cookies` without trailing slashes also resolve correctly.
- Welcome, account settings and cookie disclosures link to the release policies.
  Policy pages progressively enhance cookie controls with the same component and
  per-browser choice as the app; there is no `/me` or status request on these pages.
- `netlify build --context production` and the explicit-directory manual production
  deploy succeeded. Git CD was checked and remains unconnected. No Git commit/push
  or FastAPI Cloud backend deployment was performed for this release.
- Build, 24 unit tests, 2 release-document tests, 84 desktop/mobile Chromium E2E,
  backend Ruff check/format and 122 backend tests passed. New E2E include static
  no-JS/API-failure reading and cookie choices across document pages.
- Production smoke: all three legal URLs are HTML 200 with approved contact/date,
  no `noindex`, correct assets and security headers. Hashed assets remain immutable;
  SPA refreshes work; API JSON responses retain `no-store` and unauthenticated
  `/me` remains 401. Eighteen live no-JS checks covered three pages, three widths
  and both themes; live cookie opt-in/withdrawal worked without API requests.
- `/health/live` is 200, but `/health/ready` is still 503 and `/api/v1/status` reports
  `database: not_ready`. The app correctly keeps login disabled. This frontend
  release does not resolve database readiness or verify hosted Google consent.
- Policy maintenance: `frontend/LEGAL.md`.

## Smoke checks and launch gate

- `/` and direct refresh of `/agenda`, `/notes`, `/settings`, `/login` serve React.
- The built homepage must contain the visible **MySchedule Manager** heading,
  purpose, Google data-use disclosure, policy links and contact inside `#root`,
  outside `<noscript>`, before JavaScript or session/API responses. `npm run build`
  includes the anonymous shared-component prerender; do not deploy `vite build`
  output without running that step. Private workspace content is never prerendered.
- `/health/live` returns JSON 200; `/health/ready` must return JSON 200 before login.
- `/api/v1/status` must show `database: ready` and `google_login_configured: true`.
- `/api/v1/me` without login returns JSON 401 and `Cache-Control: no-store`, not
  `index.html`. This expected 401 is not a reason to weaken authentication.
- Begin Google login through the Netlify domain, confirm callback/state binding,
  a Secure/HttpOnly session cookie, `/me` 200, and a successful CSRF-protected mutation.
- Sign in with a second account; verify private agenda/notes never cross accounts,
  then verify logout. No provider-mocked/local test proves real hosted OAuth works.
- During initial setup FastAPI Cloud returned readiness 503 / `database: not_ready`.
  The production configuration repair above resolves that specific blocker;
  frontend deployment alone was not sufficient.
- Initial proxy checks found a localhost callback and an OAuth cookie lacking
  Secure. After the owner updated FastAPI Cloud env, rechecking on 2026-10-29
  confirmed the production Netlify callback and Secure/HttpOnly/host-only,
  SameSite=Lax OAuth cookie. PKCE remains S256 and scopes remain identity-only.
  Database readiness was still 503 at that time; it is now 200 after the Cloud
  runtime-URL repair above. Actual hosted Google consent is not verified.

## Verified first deployment (2026-10-29)

- Netlify production build completed using the root config and frontend base.
- Public `/`, `/agenda`, `/notes`, `/settings`, `/login`: HTML 200, React shell.
- `/health/live`: JSON 200. `/health/ready`: upstream JSON 503, not an SPA rewrite.
- `/api/v1/status`: JSON 200; `/api/v1/me` unauthenticated: JSON 401.
- All inspected proxied responses, including the Google 303, retained `no-store`
  and Netlify reported a cache miss without storing the private response.
- Hashed JS/CSS: 200 with `public,max-age=31536000,immutable`.
- Real deployed-page Chromium checks passed for light/dark at desktop/tablet/mobile:
  theme, preview image, no horizontal overflow, no JavaScript exception, direct
  SPA route load. Login correctly remains disabled while the database is not ready.
  Screenshots were opened during verification, not committed; local audit
  artifacts were later removed.
- Backend Ruff check/format and 122 tests passed; frontend build and 21 unit tests
  passed. Live Google consent, session cookies after consent, and private mutations
  remain unverified until backend readiness/production settings are fixed.

The Free-plan **Powered by Netlify** badge is enabled by default and overlays text
on the phone screenshot. To remove it for all visitors, the owner can turn it off
in Project configuration → General → Powered by Netlify badge → Save. This is a
hosting setting, not something to conceal with application CSS. No redeploy is
needed. See https://docs.netlify.com/manage/projects/powered-by-netlify-badge/.
