import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { SCHEMA_VERSION } from "../src/lib/schema-version";

const MIGRATIONS = "supabase/migrations";
const files = readdirSync(MIGRATIONS)
  .filter(file => file.endsWith(".sql"))
  .sort();
const numberOf = (file: string) => Number(file.slice(0, 3));

test("migrations : numérotées de 001 sans trou ni doublon", () => {
  assert.deepEqual(
    files.map(numberOf),
    files.map((_, index) => index + 1),
  );
});

test("version du schéma : SCHEMA_VERSION est le numéro de la dernière migration", () => {
  assert.equal(SCHEMA_VERSION, numberOf(files.at(-1) ?? ""));
});

test("version du schéma : chaque migration à partir de 010 inscrit son numéro", () => {
  const recorded = files.filter(file => numberOf(file) >= 10);
  assert.ok(recorded.length > 0);
  for (const file of recorded) {
    const n = numberOf(file);
    const sql = readFileSync(`${MIGRATIONS}/${file}`, "utf8");
    assert.match(
      sql,
      new RegExp(`insert into (public\\.)?schema_migrations[^;]*\\b${n}\\b`, "i"),
      `${file} n'inscrit pas ${n} dans schema_migrations`,
    );
  }
});

test("tests SQL : le script applique chaque migration", () => {
  // 001 to 007 by pattern, 008 by its test; the following ones by name.
  const script = readFileSync("supabase/tests/run.sh", "utf8");
  for (const file of files.filter(f => numberOf(f) >= 9))
    assert.ok(script.includes(file), `supabase/tests/run.sh n'applique pas ${file}`);
  assert.ok(script.includes("00[1-7]*.sql"));
  assert.ok(script.includes("supabase/tests/008_index_config.sql"));
});
