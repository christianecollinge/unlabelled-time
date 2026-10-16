# Unlabelled Time: notes for whoever works on this next

The fourth Unlabelled tool, a time tracker modelled on Tyme, for **https://time.unlabelled.cc**. A product of Unlabelled SL; never connected to Film Tools.

## Where things stand (16 October 2026)

- First version built: projects with colours, a one-at-a-time server-side timer, time entries by day with editing and manual entry, totals for today, this week, all time and per project. Tried against a local stand-in sign-in only (screenshots in the pull request). **Not deployed**: the Keycloak client `time`, the role `time`, the Neon database, the secrets and the domain mapping do not exist yet (`docs/deployment.md`).
- Not yet on the homepage (`unlabelled-website`, `src/config/products.ts`) or in the sign-in theme's list of tools; that comes after the owner has seen the first version.
- Ideas from Tyme not built: tasks inside projects, project groups (In Process, Invoiced, On Hold), statistics (hours per month, workload calendar, target hours), billable rates and revenue, export, absences.

## Working in this project

- The owner is not a terminal user and merges pull requests on GitHub themselves. Give one command per block, say which folder, never ask for a secret in chat.
- Sign-in, database and deployment follow emee (`christianecollinge/emee`); keep them in step.
- Schema changes are new steps at the end of `src/lib/migrations.ts`.
- Any change to what is stored must be reflected in the privacy policy on unlabelled.cc.
