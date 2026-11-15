# Unlabelled Time

Record the time you spend on each project. The fourth Unlabelled tool, beside the CMS, Radar and the Inbox (emee), meant for **https://time.unlabelled.cc**. Modelled on Tyme.

What the first version does:

- Projects, each with a colour; rename, recolour, archive, bring back, delete.
- A timer: press play on a project to start it, stop it from the project or the card at the top. One timer at a time: starting another stops the first. The timer lives on the server, so it keeps running with the page closed and shows on every device.
- Tasks inside projects: name a task on the running timer or on any entry (an existing one, or a new name that makes it). Clicking a project shows its tasks with their totals; click a task to see only its time, or ✎ to rename or delete it (its time stays on the project).
- A note on what you are working on, while the timer runs or afterwards.
- Time entries grouped by day, newest first, with each day's total; change any entry's project, start, end or note, or delete it; add time after the fact.
- Totals for today, this week and all time, and per project (all time and today). Clicking a project shows only its time.
- Pausing when you step away: after a set number of minutes without touching the computer (Chrome and Edge, once allowed), when the screen locks, or when the computer sleeps, the timer stops at the moment you left. A notification and the card at the top offer to resume, or to count the time away after all. The setting is kept in the browser (button at the top right).
- A reminder when nothing runs: after a set time of using the computer (20 minutes by default) with no timer running, a notification offers to resume the last project. With idle detection allowed, only time actually at the computer counts; without it, only time with the page in front.
- A quick switcher: ⌘K (Ctrl+K) or /, type a few letters of a project, Enter starts it; "shotz: homepage" also sets the note. Also on the app icon as "Start a project…".
- Pause and resume without finding the page: "Resume" on the card, the P key, the notification's Resume button, and, once installed as an app, "Pause or resume" on its Dock or taskbar icon, which shows a dot while the timer runs.

## Running it locally

```bash
npm install
npm run dev          # http://localhost:4330, no sign-in, a database in .data/
npm test             # the domain rules against an in-process Postgres
```

To try the sign-in round trip without the real Keycloak, run `npm run fake-keycloak` and start the app with the `time-signin` settings in `.claude/launch.json`.

## How it is built

The same stack and sign-in as emee: Next.js 16 (standalone output), TypeScript, Postgres (Neon in production, PGlite locally and in tests), Cloud Run in `europe-west1`, Keycloak realm `unlabelled` at `login.unlabelled.cc`. The look follows unlabelled.cc (paper, hairlines, Anton headings, the "mint and wine" palette), with a dark theme that follows the system.

- `src/lib/time.ts`: projects and entries; every function is given the workspace it acts in.
- `src/lib/migrations.ts`: the schema as numbered steps, applied on first use. Never edit a step that has run.
- `src/lib/auth.ts`, `src/proxy.ts`, `src/app/auth/`: sign-in, copied from emee with this app's own cookie names and role.
- `src/app/api/`: `GET /api/state`, and changes that each answer with the whole new state (`/api/projects`, `/api/timer`, `/api/entries`).
- `src/components/time-app.tsx`: the page.
- `src/components/away.tsx`, `src/lib/away.ts`: noticing that the person is away, the installed app's badge and service worker, the P key.
- `src/app/manifest.ts`, `public/sw.js`: what makes the app installable. The service worker caches nothing.

Deploying is described in `docs/deployment.md`.
