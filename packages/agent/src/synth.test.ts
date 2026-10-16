import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCapabilities } from "./capabilities.js";
import { resolveSampleIds } from "./sample-id.js";
import { LibraryUpdateSchema, SynthConfigSchema } from "./synth.js";

test("SynthConfigSchema accepts song intention without cards", () => {
  const r = SynthConfigSchema.safeParse({
    mode: "song",
    intention: "drums",
    bpm: 104,
  });
  assert.ok(r.success, JSON.stringify(r));
  assert.equal(r.data.mode, "song");
  assert.equal(r.data.intention, "drums");
});

test("SynthConfigSchema accepts family cards with machine knobs", () => {
  const r = SynthConfigSchema.safeParse({
    mode: "family",
    cards: [
      { role: "kick", quantity: 4, machine: { body: 0.7, punch: 0.6 } },
      { role: "hat", quantity: 3, randomness: 0.4, engines: ["noise", "subtractive"] },
    ],
  });
  assert.ok(r.success, JSON.stringify(r));
  assert.equal(r.data.cards?.length, 2);
});

test("SynthConfigSchema defaults mode to song", () => {
  const r = SynthConfigSchema.safeParse({});
  assert.ok(r.success, JSON.stringify(r));
  assert.equal(r.data.mode, "song");
});

test("LibraryUpdateSchema requires at least one mutation field", () => {
  const empty = LibraryUpdateSchema.safeParse({ samples: ["aaaaaaaa"] });
  assert.equal(empty.success, false);
  const ok = LibraryUpdateSchema.safeParse({
    samples: ["aaaaaaaa"],
    favorite: true,
  });
  assert.ok(ok.success);
});

test("resolveSampleIds unique prefixes", () => {
  const ids = [
    "aaaaaaaa-1111-4111-8111-000000000001",
    "bbbbbbbb-2222-4222-8222-000000000002",
  ];
  const r = resolveSampleIds(["aaaaaaaa", "bbbbbbbb"], ids);
  assert.ok(r.ok);
  assert.deepEqual(r.ids, ids);
  const bad = resolveSampleIds(["zzzz"], ids);
  assert.equal(bad.ok, false);
});

test("the synth example in the agent guide parses", () => {
  const doc = describeCapabilities();
  const blocks = [...doc.matchAll(/```json\n([\s\S]+?)\n```/g)].map((m) => m[1]!);
  assert.ok(blocks.length >= 2, "expected synth + arrangement examples");
  const synth = JSON.parse(blocks[0]!);
  const parsed = SynthConfigSchema.safeParse(synth);
  assert.ok(parsed.success, JSON.stringify(parsed));
  assert.equal(parsed.data.mode, "song");
  assert.ok((parsed.data.cards?.length ?? 0) >= 1);
});
