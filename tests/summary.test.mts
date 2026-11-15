import assert from "node:assert/strict";
import { test } from "node:test";
import { daysBetween, isWorkday, summarize } from "../src/lib/summary.ts";

test("a week has seven days, each starting at midnight", () => {
  const monday = new Date(2026, 10, 9);
  const days = daysBetween(monday, new Date(2026, 10, 16));
  assert.equal(days.length, 7);
  assert.equal(days[6].getDate(), 15);
  assert.ok(days.every((d) => d.getHours() === 0));
  assert.deepEqual(days.map(isWorkday), [true, true, true, true, true, false, false]);
});

test("time is added up by day, project and task, splitting entries over midnight", () => {
  const at = (day: number, hours: number) => new Date(2026, 10, day, hours).toISOString();
  const entries = [
    { projectId: "a", taskId: "t1", startedAt: at(9, 9), endedAt: at(9, 11) },
    { projectId: "b", taskId: null, startedAt: at(9, 23), endedAt: at(10, 1) },
    { projectId: "a", taskId: null, startedAt: at(10, 9), endedAt: null },
  ];
  const now = new Date(2026, 10, 10, 10).getTime();
  const week = summarize(entries, new Date(2026, 10, 9), new Date(2026, 10, 16), now);
  assert.equal(week.days[0].seconds, 3 * 3600);
  assert.deepEqual(week.days[0].byProject, [
    { projectId: "a", seconds: 7200 },
    { projectId: "b", seconds: 3600 },
  ]);
  // Tuesday: an hour of b after midnight, an hour of a still running.
  assert.equal(week.days[1].seconds, 2 * 3600);
  assert.equal(week.days[2].seconds, 0);
  assert.equal(week.seconds, 5 * 3600);
  assert.deepEqual(week.byProject, [
    { projectId: "a", seconds: 3 * 3600 },
    { projectId: "b", seconds: 2 * 3600 },
  ]);
  assert.equal(week.byTask.get("t1"), 7200);
});
