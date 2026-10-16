// The database schema, as numbered steps. A step that has run is never edited:
// a change to the schema is a new step at the end of the list.
import type { Db } from "./db.ts";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "people, workspaces, projects and time",
    sql: `
-- Every table below a workspace carries workspace_id, and points at its parent
-- through (workspace_id, id). The database itself then refuses a row that
-- would join two workspaces, whatever the application code does. The same
-- shape as emee's, so a workspace can later be shared by several people.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_sub text NOT NULL UNIQUE,
  email text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user ON workspace_members (user_id);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  color text NOT NULL DEFAULT 'wine',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX projects_workspace ON projects (workspace_id, archived_at);

-- A stretch of time spent on a project. ended_at is empty while the timer runs.
CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX time_entries_started ON time_entries (workspace_id, started_at DESC);
CREATE INDEX time_entries_project ON time_entries (project_id, started_at DESC);
-- One timer at a time: a second running entry in a workspace is refused.
CREATE UNIQUE INDEX time_entries_one_running ON time_entries (workspace_id) WHERE ended_at IS NULL;
`,
  },
];

// Held while the schema is brought up to date, so two instances starting at
// the same moment do not both run a step.
const MIGRATION_LOCK = 7_270_611;

export async function migrate(db: Db, steps: Migration[] = migrations): Promise<number[]> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await tx.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await tx.query<{ version: number }>("SELECT version FROM schema_migrations")).map((row) => row.version));
    const applied: number[] = [];
    for (const step of [...steps].sort((a, b) => a.version - b.version)) {
      if (done.has(step.version)) continue;
      await tx.exec(step.sql);
      await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [step.version, step.name]);
      applied.push(step.version);
    }
    return applied;
  });
}
