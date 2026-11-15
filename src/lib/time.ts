// Projects and the time spent on them. Every function acts within one
// workspace and is given its id: nothing here can reach another workspace's rows.
import type { Queryable } from "./db.ts";
import { projectColors, type Entry, type Project, type ProjectColor, type Snapshot, type Task } from "./types.ts";

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
  task_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  note: string;
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

const toEntry = (row: EntryRow): Entry => ({
  id: row.id,
  projectId: row.project_id,
  taskId: row.task_id,
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
  const tasks = await db.query<{ id: string; project_id: string; name: string; total_seconds: number | string }>(
    `SELECT t.id, t.project_id, t.name,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(e.ended_at, now()) - e.started_at))), 0) AS total_seconds
       FROM tasks t
       LEFT JOIN time_entries e ON e.task_id = t.id AND e.workspace_id = t.workspace_id
      WHERE t.workspace_id = $1
      GROUP BY t.id
      ORDER BY lower(t.name)`,
    [workspaceId],
  );
  const entries = await db.query<EntryRow>(
    `SELECT id, project_id, task_id, started_at, ended_at, note FROM time_entries
      WHERE workspace_id = $1 ORDER BY started_at DESC, created_at DESC LIMIT $2`,
    [workspaceId, RECENT_ENTRIES],
  );
  const [{ now }] = await db.query<{ now: Date }>("SELECT now() AS now");
  const all = entries.map(toEntry);
  const toTask = (row: (typeof tasks)[number]): Task => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    totalSeconds: Math.round(Number(row.total_seconds ?? 0)),
  });
  return { projects: projects.map(toProject), tasks: tasks.map(toTask), running: all.find((e) => e.endedAt === null) ?? null, entries: all, now: iso(now)! };
}

/** The longest stretch one request can read, for the week view and exports. */
const MAX_RANGE_DAYS = 400;

/**
 * Every entry that has time between `from` and `to`, oldest first, for the week view and
 * exports. The page works out days in its own time zone, so it is given whole entries.
 */
export async function entriesBetween(db: Queryable, workspaceId: string, input: { from?: unknown; to?: unknown }): Promise<Entry[]> {
  const from = cleanTime(input.from, "The start of the period");
  const to = cleanTime(input.to, "The end of the period");
  if (to <= from) throw new Refused("The period ends before it starts.");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new Refused(`A period can be at most ${MAX_RANGE_DAYS} days.`);
  const rows = await db.query<EntryRow>(
    `SELECT id, project_id, task_id, started_at, ended_at, note FROM time_entries
      WHERE workspace_id = $1 AND started_at < $3 AND COALESCE(ended_at, now()) > $2
      ORDER BY started_at, created_at`,
    [workspaceId, from, to],
  );
  return rows.map(toEntry);
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

/**
 * The task an entry is put on, from what the page sent: undefined leaves it as it is, an
 * empty name or null means none, a name finds the project's task of that name (whatever
 * the capitals) or makes it, and `{ id }` must be one of the project's tasks.
 */
async function taskFor(db: Queryable, workspaceId: string, projectId: string, value: unknown): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    const id = (value as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Refused("That task no longer exists.");
    const [row] = await db.query<{ id: string }>("SELECT id FROM tasks WHERE workspace_id = $1 AND project_id = $2 AND id = $3", [workspaceId, projectId, id]);
    if (!row) throw new Refused("That task is not part of this project.");
    return row.id;
  }
  if (typeof value !== "string") throw new Refused("A task's name must be text.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length > MAX_NAME) throw new Refused(`A task's name can be at most ${MAX_NAME} characters.`);
  const [found] = await db.query<{ id: string }>("SELECT id FROM tasks WHERE workspace_id = $1 AND project_id = $2 AND lower(name) = lower($3)", [
    workspaceId,
    projectId,
    name,
  ]);
  if (found) return found.id;
  const [made] = await db.query<{ id: string }>("INSERT INTO tasks (workspace_id, project_id, name) VALUES ($1, $2, $3) RETURNING id", [
    workspaceId,
    projectId,
    name,
  ]);
  return made.id;
}

/** Renames a task; a name another task of the project has already is refused. */
export async function renameTask(db: Queryable, workspaceId: string, taskId: string, input: { name?: unknown }): Promise<void> {
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new Refused("A task needs a name.");
  if (name.length > MAX_NAME) throw new Refused(`A task's name can be at most ${MAX_NAME} characters.`);
  const [task] = await db.query<{ project_id: string }>("SELECT project_id FROM tasks WHERE workspace_id = $1 AND id = $2", [workspaceId, taskId]);
  if (!task) throw new Refused("That task no longer exists.");
  const [clash] = await db.query("SELECT 1 FROM tasks WHERE project_id = $1 AND lower(name) = lower($2) AND id <> $3", [task.project_id, name, taskId]);
  if (clash) throw new Refused("This project already has a task of that name.");
  await db.query("UPDATE tasks SET name = $3 WHERE workspace_id = $1 AND id = $2", [workspaceId, taskId, name]);
}

/** Removes a task; its time stays on the project, without a task. */
export async function deleteTask(db: Queryable, workspaceId: string, taskId: string): Promise<void> {
  const rows = await db.query("DELETE FROM tasks WHERE workspace_id = $1 AND id = $2 RETURNING id", [workspaceId, taskId]);
  if (rows.length === 0) throw new Refused("That task no longer exists.");
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

/**
 * Stops whatever runs (on `projectId` only, when given). Returns whether something was stopped.
 * `at` ends it earlier than now, for time the person was away; it is kept between the entry's
 * start and now.
 */
export async function stopTimer(db: Queryable, workspaceId: string, projectId?: string, at?: Date): Promise<boolean> {
  const rows = await db.query(
    `UPDATE time_entries SET ended_at = GREATEST(LEAST(COALESCE($3::timestamptz, now()), now()), started_at), updated_at = now()
      WHERE workspace_id = $1 AND ended_at IS NULL AND ($2::uuid IS NULL OR project_id = $2) RETURNING id`,
    [workspaceId, projectId ?? null, at ?? null],
  );
  return rows.length > 0;
}

/** The end the page asked for when it stopped the timer: none (now), or a time the person was last there. */
export function stopTime(value: unknown): Date | undefined {
  return value === undefined || value === null ? undefined : cleanTime(value, "The pause");
}

/**
 * Picks up where the person left off: the timer starts again on the project and note
 * of their last entry (or of `entryId`). With `keepAwayTime`, that entry is opened
 * again instead, so the time in between counts too; only the very last entry can be.
 * Does nothing while something runs.
 */
export async function resumeTimer(
  db: Queryable,
  workspaceId: string,
  input: { entryId?: unknown; keepAwayTime?: unknown } = {},
): Promise<string> {
  const [running] = await db.query<{ id: string }>("SELECT id FROM time_entries WHERE workspace_id = $1 AND ended_at IS NULL", [workspaceId]);
  if (running) return running.id;
  const [last] = await db.query<EntryRow>(
    `SELECT id, project_id, task_id, started_at, ended_at, note FROM time_entries
      WHERE workspace_id = $1 ORDER BY ended_at DESC, started_at DESC LIMIT 1`,
    [workspaceId],
  );
  let entry = last;
  if (input.entryId !== undefined) {
    if (typeof input.entryId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.entryId)) throw new Refused("That entry no longer exists.");
    [entry] = await db.query<EntryRow>("SELECT id, project_id, task_id, started_at, ended_at, note FROM time_entries WHERE workspace_id = $1 AND id = $2", [
      workspaceId,
      input.entryId,
    ]);
  }
  if (!entry) throw new Refused(input.entryId === undefined ? "There is nothing to resume yet. Press play on a project." : "That entry no longer exists.");
  if (input.keepAwayTime) {
    if (entry.id !== last.id) throw new Refused("Other time was recorded since, so the time away cannot be added. Resume instead.");
    const [project] = await db.query<{ archived_at: Date | null }>("SELECT archived_at FROM projects WHERE id = $1", [entry.project_id]);
    if (project?.archived_at) throw new Refused("That project is archived. Bring it back first.");
    await db.query("UPDATE time_entries SET ended_at = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, entry.id]);
    return entry.id;
  }
  return startTimer(db, workspaceId, { projectId: entry.project_id, note: entry.note, task: entry.task_id ? { id: entry.task_id } : null });
}

/** Pauses what runs, or resumes the last thing when nothing does: the one-button control. */
export async function toggleTimer(db: Queryable, workspaceId: string): Promise<void> {
  if (!(await stopTimer(db, workspaceId))) await resumeTimer(db, workspaceId);
}

/** Starts the timer on a project, stopping the one that runs first: one timer at a time. */
export async function startTimer(db: Queryable, workspaceId: string, input: { projectId?: unknown; note?: unknown; task?: unknown }): Promise<string> {
  const id = await ownProject(db, workspaceId, input.projectId);
  const [project] = await db.query<{ archived_at: Date | null }>("SELECT archived_at FROM projects WHERE id = $1", [id]);
  if (project.archived_at) throw new Refused("That project is archived. Bring it back first.");
  const note = cleanNote(input.note);
  const task = (await taskFor(db, workspaceId, id, input.task)) ?? null;
  await stopTimer(db, workspaceId);
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO time_entries (workspace_id, project_id, task_id, started_at, note) VALUES ($1, $2, $3, now(), $4) RETURNING id",
    [workspaceId, id, task, note],
  );
  return row.id;
}

/** Time recorded after the fact: both ends given. */
export async function addEntry(
  db: Queryable,
  workspaceId: string,
  input: { projectId?: unknown; task?: unknown; startedAt?: unknown; endedAt?: unknown; note?: unknown },
): Promise<string> {
  const id = await ownProject(db, workspaceId, input.projectId);
  const started = cleanTime(input.startedAt, "The start");
  const ended = cleanTime(input.endedAt, "The end");
  if (ended < started) throw new Refused("The end is before the start.");
  const note = cleanNote(input.note);
  const task = (await taskFor(db, workspaceId, id, input.task)) ?? null;
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO time_entries (workspace_id, project_id, task_id, started_at, ended_at, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [workspaceId, id, task, started, ended, note],
  );
  return row.id;
}

/** Changes an entry. A running entry keeps running unless an end is given. */
export async function updateEntry(
  db: Queryable,
  workspaceId: string,
  entryId: string,
  input: { projectId?: unknown; task?: unknown; startedAt?: unknown; endedAt?: unknown; note?: unknown },
): Promise<void> {
  const [entry] = await db.query<EntryRow>("SELECT id, project_id, task_id, started_at, ended_at, note FROM time_entries WHERE workspace_id = $1 AND id = $2", [
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
  // Moved to another project without a task given: the old project's task cannot come along.
  const given = await taskFor(db, workspaceId, projectId, input.task);
  const task = given !== undefined ? given : projectId === entry.project_id ? entry.task_id : null;
  await db.query(
    `UPDATE time_entries SET project_id = $3, task_id = $7, started_at = $4, ended_at = $5, note = $6, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, entry.id, projectId, started, ended, note, task],
  );
}

export async function deleteEntry(db: Queryable, workspaceId: string, entryId: string): Promise<void> {
  const rows = await db.query("DELETE FROM time_entries WHERE workspace_id = $1 AND id = $2 RETURNING id", [workspaceId, entryId]);
  if (rows.length === 0) throw new Refused("That entry no longer exists.");
}
