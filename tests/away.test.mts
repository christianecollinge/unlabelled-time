import assert from "node:assert/strict";
import { test } from "node:test";
import { awaySince, defaultAwaySettings, readAwaySettings, readPaused, sleptSince } from "../src/lib/away.ts";

const minute = 60_000;
const now = Date.parse("2026-11-15T12:00:00Z");

test("idle means the person left a whole threshold ago; a locked screen means just now", () => {
  assert.equal(awaySince({ userState: "active", screenState: "unlocked" }, now, 10), null);
  assert.equal(awaySince({ userState: "idle", screenState: "unlocked" }, now, 10), now - 10 * minute);
  assert.equal(awaySince({ userState: "active", screenState: "locked" }, now, 10), now);
  // Both: the earlier of the two.
  assert.equal(awaySince({ userState: "idle", screenState: "locked" }, now, 10), now - 10 * minute);
});

test("a long gap between the page's steps means the computer slept", () => {
  assert.equal(sleptSince(now - 30_000, now, 10), null);
  // Hidden pages step once a minute; that alone is not sleep, even with a short threshold.
  assert.equal(sleptSince(now - 90_000, now, 1), null);
  assert.equal(sleptSince(now - 9 * minute, now, 10), null);
  assert.equal(sleptSince(now - 11 * minute, now, 10), now - 11 * minute);
});

test("stored settings fall back to the defaults and stay in range", () => {
  assert.deepEqual(readAwaySettings(null), defaultAwaySettings);
  assert.deepEqual(readAwaySettings("not json"), defaultAwaySettings);
  assert.deepEqual(readAwaySettings('{"enabled":false,"minutes":5}'), { enabled: false, minutes: 5 });
  assert.deepEqual(readAwaySettings('{"minutes":0}'), { enabled: true, minutes: 1 });
  assert.deepEqual(readAwaySettings('{"minutes":9999}'), { enabled: true, minutes: 240 });
});

test("a paused timer is remembered only when complete", () => {
  assert.equal(readPaused(null), null);
  assert.equal(readPaused('{"entryId":"a"}'), null);
  assert.deepEqual(readPaused('{"entryId":"a","projectId":"b","at":"2026-11-15T12:00:00Z","why":"odd"}'), {
    entryId: "a",
    projectId: "b",
    at: "2026-11-15T12:00:00Z",
    why: "idle",
  });
});
