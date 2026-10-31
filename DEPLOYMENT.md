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
  remediation. Database readiness remains 503 / `not_ready`, so
  real hosted login and Google's approval are still unverified.

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
  opened and remain local under `.local/cookie-bottom-live/`.
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
- Local screenshots/audit: `.local/legal-release/` and
  `docs/design/LEGAL_RELEASE_AUDIT.md`. Maintenance: `frontend/LEGAL.md`.

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
- FastAPI Cloud was reachable during setup, but its readiness returned 503 with
  `database: not_ready`. Frontend deployment alone does not resolve that blocker.
- Initial proxy checks found a localhost callback and an OAuth cookie lacking
  Secure. After the owner updated FastAPI Cloud env, rechecking on 2026-10-29
  confirmed the production Netlify callback and Secure/HttpOnly/host-only,
  SameSite=Lax OAuth cookie. PKCE remains S256 and scopes remain identity-only.
  Database readiness still returns 503 both directly and through Netlify; this is
  now the remaining observed blocker. Actual hosted Google consent is not verified.

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
  Screenshots in `.local/netlify-production/` were opened, not committed.
- Backend Ruff check/format and 122 tests passed; frontend build and 21 unit tests
  passed. Live Google consent, session cookies after consent, and private mutations
  remain unverified until backend readiness/production settings are fixed.

The Free-plan **Powered by Netlify** badge is enabled by default and overlays text
on the phone screenshot. To remove it for all visitors, the owner can turn it off
in Project configuration → General → Powered by Netlify badge → Save. This is a
hosting setting, not something to conceal with application CSS. No redeploy is
needed. See https://docs.netlify.com/manage/projects/powered-by-netlify-badge/.
