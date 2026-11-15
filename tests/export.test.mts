import assert from "node:assert/strict";
import { test } from "node:test";
import { csv, csvField, decimalHours, exportRows } from "../src/lib/export.ts";

const entry = (id: string, projectId: string, start: string, end: string | null, note = "") => ({ id, projectId, taskId: null, startedAt: start, endedAt: end, note });

test("an export holds exactly the period's time, oldest first, for one project or all", () => {
  const entries = [
    entry("b", "p", "2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z"),
    entry("a", "p", "2026-10-31T23:00:00Z", "2026-11-01T01:00:00Z"),
    entry("c", "q", "2026-11-30T23:30:00Z", null),
    entry("d", "q", "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"),
  ];
  const from = new Date("2026-11-01T00:00:00Z");
  const to = new Date("2026-12-01T00:00:00Z");
  const now = Date.parse("2026-12-01T02:00:00Z");
  const rows = exportRows(entries, from, to, now);
  assert.deepEqual(rows.map((r) => r.seconds), [3600, 3600, 1800]);
  assert.equal(rows[0].start.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(rows[2].running, true);
  assert.equal(exportRows(entries, from, to, now, "q").length, 1);
});

test("CSV fields are quoted when needed and cannot start a formula", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField('say "hi", then'), '"say ""hi"", then"');
  assert.equal(csvField("two\nlines"), '"two\nlines"');
  assert.equal(csvField("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvField(-1.5), "-1.5");
  assert.equal(csv([["a", 1], ["b", 2]]), "a,1\r\nb,2\r\n");
  assert.equal(decimalHours(4500), 1.25);
});
