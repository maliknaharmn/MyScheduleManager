# Frontend design and delivery

Use the owner's supplied `taste-SKILL.md` as the design reference. Apply its rules contextually: it explicitly excludes dense dashboards, data tables and multi-step forms. Keep the existing React/Vite stack, routes, form names/order, account boundaries, logo, and working interactions. Do not migrate design systems or install animation libraries for cosmetic compliance.

## MySchedule direction

- Preserve the current brand: cobalt for the primary action/data, lime for capacity/progress, neutral surfaces, existing system sans. Existing Lucide is the project's icon family; don't mix sets or draw new glyphs by hand.
- CSS custom properties are the theme strategy. Check light and dark, including disabled controls, dialogs, placeholders and errors. Maintain existing user theme preferences.
- Welcome is a public sign-in gateway, not a developer dashboard or a long marketing site. One Google sign-in action, no version badges, environment paths, infrastructure diagnostics, fake testimonials, fake metrics or unsupported signup claims.
- Product previews must be actual UI captures with synthetic data, labelled as illustrations. Never publish real account data or manufacture a dashboard from decorative rectangles.
- Headlines fit in two lines where they are authored copy. Preserve user-authored titles in full rather than truncating data to satisfy a marketing rule.
- Use ordinary hyphens for ranges and missing values, no em/en dashes in authored UI copy. One consistent action label per intent. Keep capability limitations accurate and understandable to users.
- Radius scale: 16-20px for working surfaces, 8-12px for controls, full-round only for circular indicators and tracks. No decorative gradients, glow, or floating chrome.
- Motion is feedback only (intensity 3): short transform/opacity feedback, reduced-motion fallback. No entrance choreography, scroll hijacking, auto-looping decorations or new dependencies.
- Mobile is deliberate: single-column forms, visible actions, 44px targets, no horizontal page overflow. Don't hide options behind clipped tabs.

## Verify

- Test loading, unavailable, retry, OAuth error and ready states. Never show a private workspace before session verification.
- Home defaults to today in the profile timezone. Intentional week/date deep links remain supported; the date below the greeting always names today. Day actions use the clicked date, not the browser date.
- Preserve optimistic-version guards and draft retention. Mutations must not be automatically retried.
- Run build, unit tests and desktop/mobile Playwright. Inspect the production build at desktop/tablet/mobile in both themes; open the screenshots. Keep audit fixtures, screenshots and reports local. Do not claim Lighthouse or real Google/Safari testing unless actually run.
