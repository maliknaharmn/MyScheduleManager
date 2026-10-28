# MySchedule icon source

The user selected the folded-paper **My** calendar icon on 28 October 2026. The approved image was adjusted with the built-in imagegen tool to remove white canvas corners while preserving its letters, calendar form, gradient, and shadows.

- `myschedule-master.png`: full-bleed source for the in-app logo, standard PWA icons, and Apple touch icon.
- `myschedule-maskable-master.png`: same identity with the calendar placed inside the central safe area for adaptive icon masks.
- `myschedule-favicon-master.png`: optically simplified source for 16/32 px browser favicons.

The PNG exports in `../../public/icons/` are resized from these sources. The masters stay outside `public` so they are not shipped in the production bundle.
