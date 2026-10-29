# Public policy maintenance

The owner approved the initial wording and publication on 2026-10-29, using
**MySchedule Manager** as the public operator identity and
**maliknahar.mn@gmail.com** as the contact. Data-copy, correction and account-deletion
requests are handled manually by email with reasonable account-ownership checks.
Never request Google passwords, OTPs or tokens by email.

## Release URLs

- Homepage: https://myschedulemanager.netlify.app/
- Privacy: https://myschedulemanager.netlify.app/privacy/
- Terms: https://myschedulemanager.netlify.app/terms/
- Cookies: https://myschedulemanager.netlify.app/cookies/

Use the homepage/privacy/terms URLs in Google Auth Platform Branding. Deployment
does not edit Google Console, verify domain ownership, or guarantee Google approval.

## Before changing a policy

1. Check the real implementation, including scopes, cookies, storage lifetime,
   processors, deletion and provider settings. Do not turn planned features into promises.
2. Update the static source HTML, effective date and any relevant in-app disclosure.
   Significant new data uses need notice and additional consent when required.
3. Keep all text readable without JavaScript, login or a working backend. Cookie
   controls are a progressive enhancement, not a prerequisite for reading.
4. Run build, unit/legal tests and desktop/mobile E2E. Inspect both themes on the
   production build, including the cookie dialog and the print/no-JS fallback.
5. Deploy `frontend/dist` only. Never copy the archived `legal-drafts/`, `.env`,
   private documents, reports or account data into public assets.

## Operational limits to preserve

- Google login requests `openid email profile`, not Gmail/Drive/Calendar access.
- Agenda/note deletion is soft-delete. Account deletion/full export is not a
  self-service feature. Logout and Google revocation do not delete the account.
- No promise of instant backup deletion or a specific server/backup retention
  deadline. The operator must handle requests and any required deadlines under
  applicable law; do not infer that this document establishes legal compliance.
- Optional theme/cache storage defaults off. Consent lasts 180 days, theme 30.
  Cache older than 30 days is not reused; age cleanup happens on subsequent writes.
  An unopened browser can retain old cache until data is cleared.
- Cookie choice is per browser/domain, not per account, and is not a server-side
  record of agreement to the Terms of Service.
