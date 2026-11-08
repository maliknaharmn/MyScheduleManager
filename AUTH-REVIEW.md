# Account access: owner review before backend activation

Status: **public-release UI for review, not a deployed password-auth service**.
The owner's latest instruction supersedes the earlier request to deploy auth
immediately: backend setup follows Malik's project review. No database migration,
production account, credential, verification token or SMTP message is created by
this UI change. Google authentication, existing sessions and calendar ownership
remain on the current backend.

## Confirmed decisions

- Public UI: Masuk, Buat akun, Lupa password, activation through an email invitation,
  reset password and authenticated Ganti password.
- Signup fields: username, email for verification, password, confirmation, in that
  order. Password fields have independent, keyboard-accessible show/hide controls.
- Login accepts username or email. Usernames are unique case-insensitively; the UI
  documents 3-30 ASCII letters/digits/dots/underscores, to be confirmed in backend review.
- Password policy chosen by owner: minimum 8 characters, at least one uppercase
  letter and one digit. Symbols are optional. UI maximum: 128 characters, subject
  to backend contract review. No lower-case/symbol requirement added silently.
- Client validation is feedback only, not enforcement or proof of password strength.
  Backend must validate independently, screen common/identity-derived passwords,
  hash passwords with a maintained password-hashing implementation and never log them.
- The password previously shared in conversation is considered exposed. It is not
  copied into source, fixtures, deployment variables or an account bootstrap.
- First password account: username `malik`, using the owner's previously supplied
  email. **Password registration initially remains closed to other users.** Google
  sign-in stays open under the existing policy.
- The owner requests the full public signup UI now, not an invitation-only visual
  design. Email/password submit buttons therefore remain disabled with an explicit
  public availability message until the backend is approved and ready.
- Malik's first password is set through an email invitation bound to the existing
  Google account's immutable user ID. Never attach an account just because someone
  typed its email or username. Do not replace the existing account or copy its data.
- Verification/reset links are expiring, single-use and must not be consumed by a
  mail scanner's GET. Final expiry, resend limits, token transport and rate limits
  are backend-review decisions, not implemented assumptions in this UI.
- Recovery and password changes are in scope; password changes revoke old sessions.
- SMTP provider: **Brevo**. The owner permits necessary activation/reset test emails
  to their supplied address once backend work is approved. No inbox access or
  activation on the owner's behalf is authorized.
- Credentials will be supplied through a private ignored local file, not chat or
  frontend variables. A verified sender and Brevo SMTP key (not API/account key)
  are required; the SMTP login is not necessarily the sender's email address.
- Eventual release includes auth and the new calendar, after this review, security
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

Native forms do not send passwords anywhere, use no storage/query cache, do not
validate invitation/reset tokens and never display fake registration/mail success.
Navigation clears form state; password reveal resets on leaving the tab. Browser
password-manager autocomplete is supported; the app does not persist credentials.

## Backend review / release gates still open

- Confirm identity linking for an existing, absent or ambiguous Google owner row;
  fail closed rather than auto-merge accounts by email.
- Confirm schema, auth-only grants/RLS, migration compatibility and limited runtime
  roles. Test on an isolated database before touching production.
- Verify Brevo sender/domain, SMTP credentials and TLS egress from FastAPI Cloud.
  Do not disable TLS verification or change hosting tiers to bypass failures.
- Agree exact endpoint contracts, password screening, invitation/reset expiry,
  retry/resend throttles, session revocation and abuse protection.
- Activate only the owner password account initially. Separate native registration
  availability from Google login readiness; do not expose invite secrets in UI.
- Update privacy disclosures for native credentials and the transactional mailer
  when those capabilities become real, then test both auth methods before release.
- Never deploy the separate local development password-login launcher to cloud.
