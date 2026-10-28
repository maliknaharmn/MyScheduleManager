# MySchedule icon source

Generated with the built-in imagegen tool on 27 October 2026. The visual direction follows `docs/design/DESIGN_SYSTEM.md` and the current Home UI: a blue calendar mark with a lime focus day. The original `public/icon.svg` remains available for rollback but is no longer referenced.

- `myschedule-master.png`: source for PWA and Apple icons. Final prompt: “A premium flat app icon for MySchedule Manager: one centered white minimalist calendar silhouette with two bold binding tabs, a blue horizontal divider, and one vivid lime focus/day marker; square full-bleed cobalt-blue canvas `#0752CB`; white `#FFFFFF` and lime `#D3FF3B` only; crisp vector-like edges; no text, numerals, checkmark, shadow, texture, gradient, or white outer corners.”
- `myschedule-favicon-master.png`: optically simplified source for 16/32 px. Final prompt: “Keep the same full-bleed cobalt canvas, white calendar/page motif, and lime focus dot; enlarge the white motif, simplify the tabs, remove the divider, and enlarge the lime dot for legibility at favicon size; no text or extra symbols.”

The PNG exports in `../../public/icons/` are resized copies of these masters. The masters are kept outside `public` so they are not shipped in the production bundle.
