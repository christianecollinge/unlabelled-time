// Projects and the time spent on them. Every function acts within one
// workspace and is given its id: nothing here can reach another workspace's rows.
import type { Queryable } from "./db.ts";
import { projectColors, type Entry, type Project, type ProjectColor, type Snapshot } from "./types.ts";

/** Something the person asked for that cannot be done; its message is shown to them. */
export class Refused extends Error {}

/** How many recent entries the page is sent. Older ones still count in the totals. */
const RECENT_ENTRIES = 300;
const MAX_NAME = 120;
const MAX_NOTE = 2000;

interface ProjectRow {
  id: string;
  name: string;
  color: string;
  archived_at: Date | null;
  total_seconds: number | string | null;
  last_worked_at: Date | null;
}

interface EntryRow {
  id: string;
  project_id: string;
  started_at: Date;
  ended_at: Date | null;
  note: string;
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

const toEntry = (row: EntryRow): Entry => ({
  id: row.id,
  projectId: row.project_id,
  startedAt: iso(row.started_at)!,
  endedAt: iso(row.ended_at),
  note: row.note,
});

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  color: isColor(row.color) ? row.color : "wine",
  archived: row.archived_at !== null,
  totalSeconds: Math.round(Number(row.total_seconds ?? 0)),
  lastWorkedAt: iso(row.last_worked_at),
});

export const isColor = (value: unknown): value is ProjectColor => projectColors.includes(value as ProjectColor);

/** Everything the page shows, read in one go. */
export async function snapshot(db: Queryable, workspaceId: string): Promise<Snapshot> {
  const projects = await db.query<ProjectRow>(
    `SELECT p.id, p.name, p.color, p.archived_at,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(e.ended_at, now()) - e.started_at))), 0) AS total_seconds,
            -- A project with no entries has no "last worked"; the LEFT JOIN's empty row must not become now().
            MAX(CASE WHEN e.id IS NULL THEN NULL ELSE COALESCE(e.ended_at, now()) END) AS last_worked_at
       FROM projects p
       LEFT JOIN time_entries e ON e.project_id = p.id AND e.workspace_id = p.workspace_id
      WHERE p.workspace_id = $1
      GROUP BY p.id
      ORDER BY p.archived_at NULLS FIRST, last_worked_at DESC NULLS LAST, p.created_at DESC`,
    [workspaceId],
  );
  const entries = await db.query<EntryRow>(
    `SELECT id, project_id, started_at, ended_at, note FROM time_entries
      WHERE workspace_id = $1 ORDER BY started_at DESC, created_at DESC LIMIT $2`,
    [workspaceId, RECENT_ENTRIES],
  );
  const [{ now }] = await db.query<{ now: Date }>("SELECT now() AS now");
  const all = entries.map(toEntry);
  return { projects: projects.map(toProject), running: all.find((e) => e.endedAt === null) ?? null, entries: all, now: iso(now)! };
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new Refused("A project needs a name.");
  if (name.length > MAX_NAME) throw new Refused(`A project's name can be at most ${MAX_NAME} characters.`);
  return name;
}

function cleanNote(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Refused("The note must be text.");
  const note = value.trim();
  if (note.length > MAX_NOTE) throw new Refused(`A note can be at most ${MAX_NOTE} characters.`);
  return note;
}

function cleanTime(value: unknown, what: string): Date {
  const date = typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new Refused(`${what} is not a time.`);
  return date;
}

async function ownProject(db: Queryable, workspaceId: string, projectId: unknown): Promise<string> {
  if (typeof projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(projectId)) throw new Refused("Choose a project.");
  const [row] = await db.query<{ id: string }>("SELECT id FROM projects WHERE workspace_id = $1 AND id = $2", [workspaceId, projectId]);
  if (!row) throw new Refused("That project no longer exists.");
  return row.id;
}

export async function createProject(db: Queryable, workspaceId: string, input: { name?: unknown; color?: unknown }): Promise<string> {
  const name = cleanName(input.name);
  const color = isColor(input.color) ? input.color : "wine";
  const [row] = await db.query<{ id: string }>("INSERT INTO projects (workspace_id, name, color) VALUES ($1, $2, $3) RETURNING id", [
    workspaceId,
    name,
    color,
  ]);
  return row.id;
}

export async function updateProject(
  db: Queryable,
  workspaceId: string,
  projectId: string,
  input: { name?: unknown; color?: unknown; archived?: unknown },
): Promise<void> {
  const id = await ownProject(db, workspaceId, projectId);
  if (input.name !== undefined) {
    await db.query("UPDATE projects SET name = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, id, cleanName(input.name)]);
  }
  if (input.color !== undefined) {
    if (!isColor(input.color)) throw new Refused("That colour is not one of the choices.");
    await db.query("UPDATE projects SET color = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, id, input.color]);
  }
  if (input.archived !== undefined) {
    // An archived project's running timer is stopped, so nothing counts on unseen.
    if (input.archived) await stopTimer(db, workspaceId, id);
    await db.query(
      `UPDATE projects SET archived_at = CASE WHEN $3 THEN COALESCE(archived_at, now()) ELSE NULL END, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id, Boolean(input.archived)],
    );
  }
}

/** Removes a project and all the time recorded on it. */
export async function deleteProject(db: Queryable, workspaceId: string, projectId: string): Promise<void> {
  const id = await ownProject(db, workspaceId, projectId);
  await db.query("DELETE FROM projects WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
}

/** Stops whatever runs (on `projectId` only, when given). Returns whether something was stopped. */
export async function stopTimer(db: Queryable, workspaceId: string, projectId?: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE time_entries SET ended_at = GREATEST(now(), started_at), updated_at = now()
      WHERE workspace_id = $1 AND ended_at IS NULL AND ($2::uuid IS NULL OR project_id = $2) RETURNING id`,
    [workspaceId, projectId ?? null],
  );
  return rows.length > 0;
}

/** Starts the timer on a project, stopping the one that runs first: one timer at a time. */
export async function startTimer(db: Queryable, workspaceId: string, input: { projectId?: unknown; note?: unknown }): Promise<string> {
  const id = await ownProject(db, workspaceId, input.projectId);
  const [project] = await db.query<{ archived_at: Date | null }>("SELECT archived_at FROM projects WHERE id = $1", [id]);
  if (project.archived_at) throw new Refused("That project is archived. Bring it back first.");
  await stopTimer(db, workspaceId);
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO time_entries (workspace_id, project_id, started_at, note) VALUES ($1, $2, now(), $3) RETURNING id",
    [workspaceId, id, cleanNote(input.note)],
  );
  return row.id;
}

/** Time recorded after the fact: both ends given. */
export async function addEntry(
  db: Queryable,
  workspaceId: string,
  input: { projectId?: unknown; startedAt?: unknown; endedAt?: unknown; note?: unknown },
): Promise<string> {
  const id = await ownProject(db, workspaceId, input.projectId);
  const started = cleanTime(input.startedAt, "The start");
  const ended = cleanTime(input.endedAt, "The end");
  if (ended < started) throw new Refused("The end is before the start.");
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO time_entries (workspace_id, project_id, started_at, ended_at, note) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [workspaceId, id, started, ended, cleanNote(input.note)],
  );
  return row.id;
}

/** Changes an entry. A running entry keeps running unless an end is given. */
export async function updateEntry(
  db: Queryable,
  workspaceId: string,
  entryId: string,
  input: { projectId?: unknown; startedAt?: unknown; endedAt?: unknown; note?: unknown },
): Promise<void> {
  const [entry] = await db.query<EntryRow>("SELECT id, project_id, started_at, ended_at, note FROM time_entries WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    entryId,
  ]);
  if (!entry) throw new Refused("That entry no longer exists.");
  const projectId = input.projectId === undefined ? entry.project_id : await ownProject(db, workspaceId, input.projectId);
  const started = input.startedAt === undefined ? new Date(entry.started_at) : cleanTime(input.startedAt, "The start");
  const ended = input.endedAt === undefined ? (entry.ended_at ? new Date(entry.ended_at) : null) : cleanTime(input.endedAt, "The end");
  if (ended && ended < started) throw new Refused("The end is before the start.");
  if (!ended && started.getTime() > Date.now() + 60_000) throw new Refused("A running timer cannot start in the future.");
  const note = input.note === undefined ? entry.note : cleanNote(input.note);
  await db.query(
    `UPDATE time_entries SET project_id = $3, started_at = $4, ended_at = $5, note = $6, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, entry.id, projectId, started, ended, note],
  );
}

export async function deleteEntry(db: Queryable, workspaceId: string, entryId: string): Promise<void> {
  const rows = await db.query("DELETE FROM time_entries WHERE workspace_id = $1 AND id = $2 RETURNING id", [workspaceId, entryId]);
  if (rows.length === 0) throw new Refused("That entry no longer exists.");
}
