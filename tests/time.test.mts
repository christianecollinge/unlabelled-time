// Runs the real schema and queries against an in-process Postgres.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openLocal, type Db } from "../src/lib/db.ts";
import { migrate } from "../src/lib/migrations.ts";
import {
  addEntry,
  createProject,
  deleteEntry,
  deleteProject,
  deleteTask,
  entriesBetween,
  Refused,
  renameTask,
  resumeTimer,
  snapshot,
  startTimer,
  stopTime,
  stopTimer,
  toggleTimer,
  updateEntry,
  updateProject,
} from "../src/lib/time.ts";
import { provisionUser } from "../src/lib/users.ts";

let db: Db;
let ana: string;
let ben: string;
// A workspace of its own for the resume tests, where "the last entry" is known.
let cy: string;
before(async () => {
  db = await openLocal();
  await migrate(db);
  ana = (await provisionUser(db, { sub: "kc-ana", email: "ana@example.com", name: "Ana" })).workspaceId;
  ben = (await provisionUser(db, { sub: "kc-ben", email: "ben@example.com", name: "Ben" })).workspaceId;
  cy = (await provisionUser(db, { sub: "kc-cy", email: "cy@example.com", name: "Cy" })).workspaceId;
});
after(() => db.close());

const hour = 3_600_000;

test("migrations run once", async () => {
  assert.deepEqual(await migrate(db), []);
});

test("a project is made with a clean name and a known colour", async () => {
  const id = await createProject(db, ana, { name: "  Shotz   Website ", color: "teal" });
  const state = await snapshot(db, ana);
  const project = state.projects.find((p) => p.id === id)!;
  assert.equal(project.name, "Shotz Website");
  assert.equal(project.color, "teal");
  assert.equal(project.totalSeconds, 0);
  assert.equal(project.lastWorkedAt, null);
  await assert.rejects(createProject(db, ana, { name: "   " }), Refused);
  const other = await createProject(db, ana, { name: "Odd colour", color: "chartreuse" });
  assert.equal((await snapshot(db, ana)).projects.find((p) => p.id === other)!.color, "wine");
});

test("one timer at a time: starting another stops the first", async () => {
  const a = await createProject(db, ana, { name: "A" });
  const b = await createProject(db, ana, { name: "B" });
  const first = await startTimer(db, ana, { projectId: a, note: "calls" });
  let state = await snapshot(db, ana);
  assert.equal(state.running?.id, first);
  assert.equal(state.running?.note, "calls");
  const second = await startTimer(db, ana, { projectId: b });
  state = await snapshot(db, ana);
  assert.equal(state.running?.id, second);
  assert.ok(state.entries.find((e) => e.id === first)!.endedAt);
  assert.equal(await stopTimer(db, ana), true);
  assert.equal((await snapshot(db, ana)).running, null);
  assert.equal(await stopTimer(db, ana), false);
  // The database refuses a second running entry even if the code forgot to stop the first.
  await startTimer(db, ana, { projectId: a });
  await assert.rejects(db.query("INSERT INTO time_entries (workspace_id, project_id, started_at) VALUES ($1, $2, now())", [ana, b]));
  await stopTimer(db, ana);
});

test("time added afterwards counts in the project's total", async () => {
  const p = await createProject(db, ana, { name: "Totals" });
  const end = Date.now() - hour;
  await addEntry(db, ana, { projectId: p, startedAt: new Date(end - 2 * hour).toISOString(), endedAt: new Date(end).toISOString(), note: "design" });
  await addEntry(db, ana, { projectId: p, startedAt: new Date(end - 5 * hour).toISOString(), endedAt: new Date(end - 4.5 * hour).toISOString() });
  const project = (await snapshot(db, ana)).projects.find((x) => x.id === p)!;
  assert.equal(project.totalSeconds, 2.5 * 3600);
  assert.equal(project.lastWorkedAt, new Date(end).toISOString());
  await assert.rejects(addEntry(db, ana, { projectId: p, startedAt: new Date(end).toISOString(), endedAt: new Date(end - hour).toISOString() }), /before the start/);
  await assert.rejects(addEntry(db, ana, { projectId: p, startedAt: "yesterday", endedAt: new Date(end).toISOString() }), Refused);
});

test("an entry can be moved, retimed, renoted and deleted", async () => {
  const p = await createProject(db, ana, { name: "From" });
  const q = await createProject(db, ana, { name: "To" });
  const start = Date.now() - 3 * hour;
  const id = await addEntry(db, ana, { projectId: p, startedAt: new Date(start).toISOString(), endedAt: new Date(start + hour).toISOString() });
  await updateEntry(db, ana, id, { projectId: q, endedAt: new Date(start + 2 * hour).toISOString(), note: "moved" });
  let entry = (await snapshot(db, ana)).entries.find((e) => e.id === id)!;
  assert.equal(entry.projectId, q);
  assert.equal(entry.note, "moved");
  assert.equal(Date.parse(entry.endedAt!) - Date.parse(entry.startedAt), 2 * hour);
  await assert.rejects(updateEntry(db, ana, id, { startedAt: new Date(start + 3 * hour).toISOString() }), /before the start/);
  // A running entry keeps running when only its note or start changes.
  const running = await startTimer(db, ana, { projectId: p });
  await updateEntry(db, ana, running, { note: "still going", startedAt: new Date(Date.now() - hour).toISOString() });
  entry = (await snapshot(db, ana)).entries.find((e) => e.id === running)!;
  assert.equal(entry.endedAt, null);
  assert.equal(entry.note, "still going");
  await stopTimer(db, ana);
  await deleteEntry(db, ana, id);
  assert.equal((await snapshot(db, ana)).entries.some((e) => e.id === id), false);
  await assert.rejects(deleteEntry(db, ana, id), Refused);
});

test("archiving stops a running timer and keeps the time; deleting removes it", async () => {
  const p = await createProject(db, ana, { name: "Old" });
  await startTimer(db, ana, { projectId: p });
  await updateProject(db, ana, p, { archived: true });
  let state = await snapshot(db, ana);
  assert.equal(state.running, null);
  assert.equal(state.projects.find((x) => x.id === p)!.archived, true);
  await assert.rejects(startTimer(db, ana, { projectId: p }), /archived/);
  await updateProject(db, ana, p, { archived: false, name: "Old, back", color: "sage" });
  state = await snapshot(db, ana);
  assert.equal(state.projects.find((x) => x.id === p)!.name, "Old, back");
  await deleteProject(db, ana, p);
  state = await snapshot(db, ana);
  assert.equal(state.projects.some((x) => x.id === p), false);
  assert.equal(state.entries.some((e) => e.projectId === p), false);
});

test("nobody reaches another workspace's projects or time", async () => {
  const mine = await createProject(db, ana, { name: "Ana's" });
  const entry = await addEntry(db, ana, { projectId: mine, startedAt: new Date(Date.now() - hour).toISOString(), endedAt: new Date().toISOString() });
  await assert.rejects(startTimer(db, ben, { projectId: mine }), Refused);
  await assert.rejects(updateProject(db, ben, mine, { name: "Ben's now" }), Refused);
  await assert.rejects(deleteProject(db, ben, mine), Refused);
  await assert.rejects(updateEntry(db, ben, entry, { note: "x" }), Refused);
  await assert.rejects(deleteEntry(db, ben, entry), Refused);
  const benState = await snapshot(db, ben);
  assert.equal(benState.projects.length, 0);
  assert.equal(benState.entries.length, 0);
  // And the database itself refuses an entry that joins two workspaces.
  await assert.rejects(db.query("INSERT INTO time_entries (workspace_id, project_id, started_at, ended_at) VALUES ($1, $2, now(), now())", [ben, mine]));
});

test("pausing for time away ends the entry when the person was last there", async () => {
  const p = await createProject(db, ana, { name: "Away" });
  const id = await startTimer(db, ana, { projectId: p, note: "drafting" });
  await updateEntry(db, ana, id, { startedAt: new Date(Date.now() - 2 * hour).toISOString() });
  assert.equal(await stopTimer(db, ana, undefined, stopTime(new Date(Date.now() - hour).toISOString())), true);
  const entry = (await snapshot(db, ana)).entries.find((e) => e.id === id)!;
  assert.ok(Math.abs(Date.parse(entry.endedAt!) - Date.parse(entry.startedAt) - hour) < 5_000);
  // A pause before the start or in the future is kept within the entry.
  const again = await startTimer(db, ana, { projectId: p });
  await stopTimer(db, ana, undefined, new Date(Date.now() - 10 * hour));
  const short = (await snapshot(db, ana)).entries.find((e) => e.id === again)!;
  assert.equal(short.endedAt, short.startedAt);
  await deleteEntry(db, ana, again);
  assert.throws(() => stopTime("soon"), Refused);
  assert.equal(stopTime(undefined), undefined);
});

test("resuming picks up the last project and note, or carries the last entry on", async () => {
  const p = await createProject(db, cy, { name: "Resume" });
  const first = await startTimer(db, cy, { projectId: p, note: "editing" });
  await updateEntry(db, cy, first, { startedAt: new Date(Date.now() - 2 * hour).toISOString() });
  await stopTimer(db, cy, undefined, new Date(Date.now() - hour));
  // Resume: a new entry on the same project and note; the hour away is not counted.
  const second = await resumeTimer(db, cy);
  let state = await snapshot(db, cy);
  assert.notEqual(second, first);
  assert.equal(state.running?.id, second);
  assert.equal(state.running?.projectId, p);
  assert.equal(state.running?.note, "editing");
  // Resuming while something runs changes nothing.
  assert.equal(await resumeTimer(db, cy), second);
  await deleteEntry(db, cy, second);
  // Keeping the time away opens the last entry again, so it runs on from its start.
  assert.equal(await resumeTimer(db, cy, { entryId: first, keepAwayTime: true }), first);
  state = await snapshot(db, cy);
  assert.equal(state.running?.id, first);
  assert.equal(state.running?.endedAt, null);
  await stopTimer(db, cy);
  // Only the very last entry can be carried on.
  await startTimer(db, cy, { projectId: p });
  await stopTimer(db, cy);
  await assert.rejects(resumeTimer(db, cy, { entryId: first, keepAwayTime: true }), /Other time/);
  // Nobody resumes another workspace's entry, and an empty workspace has nothing to resume.
  await assert.rejects(resumeTimer(db, ben, { entryId: first }), /no longer exists/);
  await assert.rejects(resumeTimer(db, ben), /nothing to resume/);
});

test("the one-button control pauses what runs and resumes the last thing", async () => {
  const p = await createProject(db, cy, { name: "Toggle" });
  await startTimer(db, cy, { projectId: p, note: "calls" });
  await toggleTimer(db, cy);
  assert.equal((await snapshot(db, cy)).running, null);
  await toggleTimer(db, cy);
  const running = (await snapshot(db, cy)).running;
  assert.equal(running?.projectId, p);
  assert.equal(running?.note, "calls");
  await toggleTimer(db, cy);
});

test("tasks are made by naming them, belong to one project, and keep their time when deleted", async () => {
  const p = await createProject(db, ana, { name: "Tasks" });
  const q = await createProject(db, ana, { name: "Other" });
  const first = await startTimer(db, ana, { projectId: p, task: " Design  work " });
  let state = await snapshot(db, ana);
  const design = state.tasks.find((t) => t.projectId === p && t.name === "Design work")!;
  assert.ok(design);
  assert.equal(state.running?.taskId, design.id);
  // The same name, whatever the capitals, is the same task.
  const second = await startTimer(db, ana, { projectId: p, task: "design WORK" });
  state = await snapshot(db, ana);
  assert.equal(state.running?.taskId, design.id);
  assert.equal(state.tasks.filter((t) => t.projectId === p).length, 1);
  await stopTimer(db, ana);
  // Resuming keeps the task.
  await resumeTimer(db, ana);
  assert.equal((await snapshot(db, ana)).running?.taskId, design.id);
  await stopTimer(db, ana);
  // A task of another project is refused; moving an entry drops its task.
  await assert.rejects(startTimer(db, ana, { projectId: q, task: { id: design.id } }), /not part of this project/);
  await updateEntry(db, ana, first, { projectId: q });
  assert.equal((await snapshot(db, ana)).entries.find((e) => e.id === first)!.taskId, null);
  // An empty name means no task.
  await updateEntry(db, ana, second, { task: "" });
  assert.equal((await snapshot(db, ana)).entries.find((e) => e.id === second)!.taskId, null);
  await updateEntry(db, ana, second, { task: "Calls" });
  const calls = (await snapshot(db, ana)).tasks.find((t) => t.projectId === p && t.name === "Calls")!;
  await assert.rejects(renameTask(db, ana, calls.id, { name: "DESIGN work" }), /already has a task/);
  await renameTask(db, ana, calls.id, { name: "Phone calls" });
  await assert.rejects(renameTask(db, ben, calls.id, { name: "Ben's" }), /no longer exists/);
  await assert.rejects(deleteTask(db, ben, calls.id), Refused);
  await deleteTask(db, ana, calls.id);
  state = await snapshot(db, ana);
  assert.equal(state.tasks.some((t) => t.id === calls.id), false);
  const kept = state.entries.find((e) => e.id === second)!;
  assert.equal(kept.taskId, null);
  assert.equal(kept.projectId, p);
});

test("a period's entries include those that overlap it, and nobody else's", async () => {
  const p = await createProject(db, cy, { name: "Period" });
  const base = Date.parse("2026-03-02T09:00:00Z");
  const inside = await addEntry(db, cy, { projectId: p, startedAt: new Date(base).toISOString(), endedAt: new Date(base + hour).toISOString() });
  const overlapping = await addEntry(db, cy, { projectId: p, startedAt: new Date(base - 2 * hour).toISOString(), endedAt: new Date(base - 0.5 * hour).toISOString() });
  await addEntry(db, cy, { projectId: p, startedAt: new Date(base - 5 * hour).toISOString(), endedAt: new Date(base - 4 * hour).toISOString() });
  const from = new Date(base - hour).toISOString();
  const to = new Date(base + 3 * hour).toISOString();
  assert.deepEqual((await entriesBetween(db, cy, { from, to })).map((e) => e.id), [overlapping, inside]);
  assert.deepEqual(await entriesBetween(db, ben, { from, to }), []);
  await assert.rejects(entriesBetween(db, cy, { from: to, to: from }), /ends before/);
  await assert.rejects(entriesBetween(db, cy, { from: "2020-01-01T00:00:00Z", to }), /at most/);
  await assert.rejects(entriesBetween(db, cy, { from: "soon", to }), Refused);
});
