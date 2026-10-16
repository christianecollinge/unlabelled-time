import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, clock, entrySeconds, fromLocalInput, hoursMinutes, secondsWithin, startOfWeek, toLocalInput } from "../src/lib/format.ts";

test("durations read as hours and minutes, without wrapping at a day", () => {
  assert.equal(hoursMinutes(0), "0:00");
  assert.equal(hoursMinutes(59), "0:00");
  assert.equal(hoursMinutes(5025), "1:23");
  assert.equal(hoursMinutes(100 * 3600), "100:00");
  assert.equal(hoursMinutes(-5), "0:00");
  assert.equal(clock(5025), "1:23:45");
});

test("a running entry counts up to now, and only the part inside a period counts there", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const running = { startedAt: "2026-10-16T11:30:00Z", endedAt: null };
  assert.equal(entrySeconds(running, now), 1800);
  const overnight = { startedAt: "2026-10-15T23:00:00Z", endedAt: "2026-10-16T01:00:00Z" };
  assert.equal(secondsWithin(overnight, Date.parse("2026-10-16T00:00:00Z"), Infinity, now), 3600);
  assert.equal(secondsWithin(overnight, Date.parse("2026-10-17T00:00:00Z"), Infinity, now), 0);
});

test("weeks start on Monday", () => {
  const monday = startOfWeek(new Date(2026, 9, 18, 15)); // a Sunday
  assert.equal(monday.getDay(), 1);
  assert.equal(monday.getDate(), 12);
  assert.equal(startOfWeek(new Date(2026, 9, 12, 9)).getDate(), 12);
});

test("last worked reads in words", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(ago(null, now), "Not worked on yet");
  assert.equal(ago("2026-10-16T11:59:50Z", now), "Just now");
  assert.equal(ago("2026-10-15T12:00:00Z", now), "Yesterday");
  assert.equal(ago("2024-10-16T12:00:00Z", now), "2 years ago");
});

test("datetime fields go there and back", () => {
  const iso = new Date(2026, 9, 16, 9, 5).toISOString();
  assert.equal(toLocalInput(iso), "2026-10-16T09:05");
  assert.equal(fromLocalInput("2026-10-16T09:05"), iso);
  assert.equal(fromLocalInput("not a time"), null);
});
