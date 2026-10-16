# Unlabelled Time

Record the time you spend on each project. The fourth Unlabelled tool, beside the CMS, Radar and the Inbox (emee), meant for **https://time.unlabelled.cc**. Modelled on Tyme.

What the first version does:

- Projects, each with a colour; rename, recolour, archive, bring back, delete.
- A timer: press play on a project to start it, stop it from the project or the card at the top. One timer at a time: starting another stops the first. The timer lives on the server, so it keeps running with the page closed and shows on every device.
- A note on what you are working on, while the timer runs or afterwards.
- Time entries grouped by day, newest first, with each day's total; change any entry's project, start, end or note, or delete it; add time after the fact.
- Totals for today, this week and all time, and per project (all time and today). Clicking a project shows only its time.

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

Deploying is described in `docs/deployment.md`.
