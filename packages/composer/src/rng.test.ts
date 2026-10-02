import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeRng, rng, shuffle, withSalt } from "./rng.js";

describe("rng locality", () => {
  it("is deterministic for the same seed+path", () => {
    assert.equal(rng(42, "form"), rng(42, "form"));
    assert.notEqual(rng(42, "form"), rng(42, "harmony"));
  });

  it("changing salt of track:3/* does not change other tracks", () => {
    const seed = 99;
    const r0 = makeRng(seed);
    const pathsOther = [
      "track:0/kick/phrase:A/motif",
      "track:1/snare/phrase:A/motif",
      "track:2/hat/phrase:A/motif",
      "form",
      "harmony/chorus#0",
    ];
    const before = pathsOther.map((p) => r0(p));

    const salt = "regen-1";
    const r1 = makeRng(seed);
    const after = pathsOther.map((p) => r1(p));
    assert.deepEqual(after, before);

    // Salted track:3 path changes
    const base = "track:3/lead/phrase:A/motif";
    assert.notEqual(rng(seed, base), rng(seed, withSalt(base, salt)));

    // Unrelated track:3 sibling without salt stays stable when we only
    // compare against itself (addressed RNG has no sequential state).
    const sibling = "track:3/lead/phrase:B/motif";
    assert.equal(rng(seed, sibling), rng(seed, sibling));
  });

  it("shuffle uses path#i and is reproducible", () => {
    const r = makeRng(7);
    const a = shuffle(r, "kit", [0, 1, 2, 3, 4, 5]);
    const b = shuffle(makeRng(7), "kit", [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(a, b);
    const c = shuffle(makeRng(7), "kit-other", [0, 1, 2, 3, 4, 5]);
    assert.notDeepEqual(a, c);
  });
});
