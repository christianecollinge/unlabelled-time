import assert from "node:assert/strict";
import { test } from "node:test";
import { matchScore, matching } from "../src/lib/switcher.ts";

test("a project is found by its start, a word, any part, or its letters in order", () => {
  assert.equal(matchScore("Shotz website", "sho"), 4);
  assert.equal(matchScore("Shotz website", "web"), 3);
  assert.equal(matchScore("Shotz website", "tz w"), 2);
  assert.equal(matchScore("Shotz website", "shw"), 1);
  assert.equal(matchScore("Shotz website", "xyz"), 0);
  assert.equal(matchScore("Anything", "   "), 1);
});

test("the best matches come first, and equal ones keep their order", () => {
  const items = [{ name: "Admin" }, { name: "Website" }, { name: "Web shop" }, { name: "New web app" }];
  assert.deepEqual(matching(items, "web").map((i) => i.name), ["Website", "Web shop", "New web app"]);
  assert.deepEqual(matching(items, "").map((i) => i.name), ["Admin", "Website", "Web shop", "New web app"]);
});
