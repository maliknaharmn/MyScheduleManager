# Account access: approved UI and backend release gates

Status: **UI approved by Malik; backend implementation and eventual auth + calendar
release authorized after security tests and safe migration readiness.** The native
backend and frontend wiring are implemented and tested locally. Native auth defaults
off until the compatibility rollout, production migration and cloud SMTP checks pass.
No production password invitation or activation has occurred at this preflight stage.
Google authentication, existing sessions and calendar ownership remain unchanged.

## Confirmed decisions

- Public UI: Masuk, Buat akun, Lupa password, activation through an email invitation,
  reset password and authenticated Ganti password.
- Signup fields: username, email for verification, password, confirmation, in that
  order. Password fields have independent, keyboard-accessible show/hide controls.
- Login accepts username or email. Usernames are unique case-insensitively; the UI
  documents 3-30 ASCII letters/digits/dots/underscores. Initial enrollment fixes the
  server-owned username to `malik`; arbitrary username registration is not enabled.
- Password policy chosen by owner: minimum 8 characters, at least one uppercase
  letter and one digit. Symbols are optional. Server and UI maximum: 128 characters.
  No lower-case/symbol requirement added silently.
- Client validation is feedback only, not enforcement or proof of password strength.
  Backend must validate independently, screen common/identity-derived passwords,
  hash passwords with a maintained password-hashing implementation and never log them.
- The password previously shared in conversation is considered exposed. It is not
  copied into source, fixtures, deployment variables or an account bootstrap.
- First password account: username `malik`, using the owner's previously supplied
  email. **Password registration initially remains closed to other users.** Google
  sign-in stays open under the existing policy.
- The owner approved the full public signup UI, not an invitation-only visual
  design. Native forms require server-confirmed readiness. UI approval does not
  open general password registration; that submit remains disabled even when login
  is ready, with the owner-only policy explained and Google still available.
- Malik's first password is set through an email invitation bound to the existing
  Google account's immutable user ID. Never attach an account just because someone
  typed its email or username. Do not replace the existing account or copy its data.
- Verification/reset links are single-use and must not be consumed by a mail
  scanner's GET. Owner confirmed activation invitations expire after 24 hours and
  reset links after 30 minutes. A replacement invalidates the old link only after
  successful issuance. Link secrets travel in the URL fragment, then POST bodies,
  never server-visible query parameters or browser storage.
- Owner approved 5 login attempts per identifier per 15 minutes, a 60-second email
  resend cooldown and at most 3 emails per account per hour, with persistent server
  protection and no permanent lockout or new restrictions on Google login.
- Recovery and password changes are in scope. Owner confirmed all old application
  sessions, including Google-created sessions and the changing browser, are revoked
  after activation/reset/change; login is required again. This does not revoke the
  user's Google-provider session or automatically sign in from an email link.
- SMTP provider: **Brevo**. The owner permits necessary activation/reset test emails
  to their supplied address. No inbox access or
  activation on the owner's behalf is authorized.
- Credentials will be supplied through a private ignored local file, not chat or
  frontend variables. A verified sender and Brevo SMTP key (not API/account key)
  are required; the SMTP login is not necessarily the sender's email address.
- Eventual release includes auth and the new calendar, after security
  tests, safe migration testing and real email configuration. No cloud upgrade,
  provider replacement or production bypass is implied.

## Current UI behavior

Routes: `/login`, `/signup`, `/forgot-password`, `/activate-password`,
`/reset-password`, `/settings/security`. The last route requires `/me` verification
before showing a change-password form. Login/signup detect an existing session
and link back to the workspace instead of pretending another login is necessary.

Google uses the existing same-origin OAuth start URL, callback, identity-only scopes,
session checks, CSRF and RLS. Only one Google action appears per page. Its loading,
unavailable/retry and callback-error states remain truthful.

Native forms use the documented server endpoints only after readiness/CSRF checks.
Passwords and email-link tokens stay outside browser storage and query/mutation
caches. Tokens arrive in fragments, are removed from the current history entry,
and require an explicit POST; no GET activates a credential. Navigation clears form
state; password reveal resets on leaving the tab. Login waits for verified `/me`.
Email responses are conditional, not fake delivery/inbox success. Password changes
clear the account cache and require login again. Browser autocomplete is supported.

## Verified after owner approval (2026-11-08)

- Private Brevo configuration has all required fields, permissions `600`, and the
  stored SMTP login matches the owner-supplied login. No secret values are recorded here.
- Certificate-verified STARTTLS and SMTP authentication passed from this machine
  after the owner authorized its IP. Exactly one harmless connectivity email was
  accepted by Brevo for the approved owner recipient. It contained no credentials,
  tokens or activation action. Owner subsequently confirmed inbox receipt. No further
  connectivity emails are needed before the actual invitation.
- Cloud frontend and API readiness passed. Anonymous `/me` remained `401` with
  `Cache-Control: no-store`; Google start returned `303`, identity-only scopes and
  S256 PKCE. These checks do not prove a completed Google login or private writes.
- Read-only production lookup found exactly one matching Google owner account,
  not disabled. Its immutable ID and private account data were not printed or changed.
- Production runtime configuration has no migration-owner connection. Existing
  validation URLs target a different database and must not be reused for production.
  The owner subsequently chose existing Neon CLI access: its authenticated project
  has one exact matching production write endpoint. The direct connection for the
  actual table owner passed read-only ownership/revision checks and was saved only
  to the private migration file (`600`). Runtime cloud roles were not changed.
- Native implementation is covered by dedicated local PostgreSQL tests. Migration
  `0002` adds only three auth-private tables, with app/worker denied all access to
  password hashes, link hashes and HMAC throttle buckets. Existing `users` and
  account data are not replaced. Argon2id hashing and offline common/identity-derived
  screening are implemented; the screening is not a complete breach-password lookup.
- Fresh baseline verification passed: 140 backend tests on the dedicated local
  `_test` database, Ruff/check-format, the frontend production build, 51 frontend
  unit tests, 140 desktop/mobile E2E and 4 static/legal tests. Initial unconstrained
  unit tests had two lazy-load wait timeouts under parallel backend/test load;
  rerunning the unchanged suite with two workers passed. No test assertion or
  timeout was weakened. These are existing-feature tests, not proof of native auth.
- Production revision is still `0001`; neither runtime role can create public
  tables and the auth role does not own `users`. An empty migration-secret template
  was prepared at the owner's root `.local/auth-production-migration.env`, then
  populated through the verified CLI without exposing its value.
- Owner confirmed the connectivity email arrived in the inbox. SMTP from FastAPI
  Cloud's actual outbound IP still needs separate verification before activation.
- Owner additionally approved a temporary ordinary Neon branch and commit/push of
  the tested auth + calendar changes followed by merge to `main`. No unrelated dirty
  files in the original worktree are included.
- Migration passed on that isolated production clone: `0001` to `0002`, no metadata
  drift, both compatibility/native readiness checks, auth-only grants and unchanged
  user/session counts. No mail or password activation was performed there. The
  approved ephemeral branch was deleted; production runtime URLs were untouched.
- Final preflight passed: **176 backend tests**, Ruff/check-format, production build,
  **52 frontend unit tests, 152 desktop/mobile E2E and 4 static/legal checks**. SMTP
  environment-string port parsing has a regression test. The final production-build
  visual checks retain the approved brand/forms in both themes without overflow.

## Production release gates still open

- Perform a compatibility-first rollout: the old readiness probe accepts only schema
  revision `0001`. Deploy and verify support for both old/new schemas with native
  auth disabled before migrating; do not make the old live release fail readiness.
- Verify Brevo sender/domain, SMTP credentials and TLS egress from FastAPI Cloud.
  Do not disable TLS verification or change hosting tiers to bypass failures.
- Activate only the owner password account initially. Separate native registration
  availability from Google login readiness; do not expose invite secrets in UI.
- Publish the updated privacy, cookie and terms disclosures with frontend wiring.
- Send the real invitation only after production checks. The owner alone opens it
  and chooses a replacement password; real hosted login still needs owner confirmation.
- Never deploy the separate local development password-login launcher to cloud.
