// Runs the real schema and queries against an in-process Postgres.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openLocal, type Db } from "../src/lib/db.ts";
import { migrate } from "../src/lib/migrations.ts";
import { addEntry, createProject, deleteEntry, deleteProject, Refused, snapshot, startTimer, stopTimer, updateEntry, updateProject } from "../src/lib/time.ts";
import { provisionUser } from "../src/lib/users.ts";

let db: Db;
let ana: string;
let ben: string;
before(async () => {
  db = await openLocal();
  await migrate(db);
  ana = (await provisionUser(db, { sub: "kc-ana", email: "ana@example.com", name: "Ana" })).workspaceId;
  ben = (await provisionUser(db, { sub: "kc-ben", email: "ben@example.com", name: "Ben" })).workspaceId;
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
