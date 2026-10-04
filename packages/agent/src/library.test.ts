import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterLibrary,
  formatLibraryTable,
  librarySummary,
  shortIdLength,
  type AgentLibraryRow,
} from "./library.js";

const rows: AgentLibraryRow[] = [
  { id: "aaaaaaaa-1", name: "Porte", class: "percussive", role: "kick", durationMs: 400, tags: ["wood"], interest: 0.4 },
  { id: "aaaaaaab-2", name: "Pluie", class: "texture", role: "texture", durationMs: 8000, loopStartMs: 100, loopEndMs: 7000, tags: ["rain"], favorite: true },
  { id: "cccccccc-3", name: "Bol", class: "tonal", role: "lead", durationMs: 2500, note: "A3", pitchConfidence: 0.9, tags: ["metal"], rating: 5 },
];

test("short ids grow until unique", () => {
  assert.equal(shortIdLength(rows.map((r) => r.id), 6), 8);
  assert.equal(shortIdLength(["abcdef12", "abcdef13"], 4), 8);
});

test("filters combine and favorites sort first", () => {
  assert.equal(filterLibrary(rows, { loopable: true }).total, 1);
  assert.equal(filterLibrary(rows, { pitched: true }).rows[0]!.name, "Bol");
  assert.equal(filterLibrary(rows, { text: "rain" }).rows[0]!.name, "Pluie");
  assert.equal(filterLibrary(rows, { roles: ["KICK"] }).total, 1);
  assert.equal(filterLibrary(rows).rows[0]!.name, "Pluie");
});

test("table has one header and one line per row", () => {
  const t = formatLibraryTable(rows);
  const lines = t.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[2]!, /\t100-7000\t/);
  assert.match(lines[3]!, /\tA3\t/);
  assert.equal(librarySummary(rows).pitched, 1);
});
