# Netlify frontend + FastAPI Cloud backend

Production frontend: **https://myschedulemanager.netlify.app**.
Dashboard: https://app.netlify.com/projects/myschedulemanager.
Created via authenticated CLI; Git continuous deployment is not connected yet.
Latest production deploy ID: `6ae307e299941b4da528f2e9` (public legal/cookie release, 2026-10-29).
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
