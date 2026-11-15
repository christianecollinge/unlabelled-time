# Unlabelled Time: notes for whoever works on this next

The fourth Unlabelled tool, a time tracker modelled on Tyme, for **https://time.unlabelled.cc**. A product of Unlabelled SL; never connected to Film Tools.

## Where things stand (16 October 2026)

- First version built: projects with colours, a one-at-a-time server-side timer, time entries by day with editing and manual entry, totals for today, this week, all time and per project. Tried against a local stand-in sign-in only (screenshots in the pull request). **Not deployed**: the Keycloak client `time`, the role `time`, the Neon database, the secrets and the domain mapping do not exist yet (`docs/deployment.md`).
- Not yet on the homepage (`unlabelled-website`, `src/config/products.ts`) or in the sign-in theme's list of tools; that comes after the owner has seen the first version.
- Pause when away and quick pause/resume added (15 November 2026): idle detection, lock and sleep stop the timer at the moment the person left; installable app with a "Pause or resume" Dock shortcut and badge; `POST /api/timer/resume` and `/api/timer/toggle`. The away settings live in the browser's local storage, so nothing new is stored on the server.
- Tasks inside projects added (migration 2: `tasks`, `time_entries.task_id`). Task names are new stored data: **the privacy policy on unlabelled.cc needs a line about them.**
- Ideas from Tyme not built: project groups (In Process, Invoiced, On Hold), statistics beyond the week view (hours per month, workload calendar), billable rates and revenue, absences.

## Working in this project

- The owner is not a terminal user and merges pull requests on GitHub themselves. Give one command per block, say which folder, never ask for a secret in chat.
- Sign-in, database and deployment follow emee (`christianecollinge/emee`); keep them in step.
- Schema changes are new steps at the end of `src/lib/migrations.ts`.
- Any change to what is stored must be reflected in the privacy policy on unlabelled.cc.
