import assert from "node:assert/strict";
import test from "node:test";
import { CHANGELOG } from "../src/lib/changelog";

test("changelog entries are dated, newest first, and non-empty", () => {
  assert.ok(CHANGELOG.length > 0);
  for (const release of CHANGELOG) {
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(release.date)), release.date);
    assert.ok(release.title.trim());
    assert.ok(release.items.length > 0 && release.items.every(item => item.trim()));
  }
  const dates = CHANGELOG.map(release => release.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal(new Set(dates).size, dates.length, "one entry per date");
});
