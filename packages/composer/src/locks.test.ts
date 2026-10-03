import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "./compose.js";
import { locksFromLayers } from "./locks.js";
import { makeComposeRng, rng, withSalt } from "./rng.js";
import type { ComposeSettings } from "./types.js";

function base(partial?: Partial<ComposeSettings>): ComposeSettings {
  return {
    seed: 42,
    style: "pop",
    targetBars: 32,
    formFamily: "verse-chorus",
    energyShape: "arch",
    energy: 0.6,
    density: 1,
    drumsVsTexture: 0.6,
    variation: 0.3,
    life: 0.5,
    space: 0.4,
    swing: 0,
    humanize: 0.4,
    keyPc: 0,
    mode: "ionian",
    tuningRef: "440",
    targetLufs: -14,
    ...partial,
  };
}

describe("makeComposeRng", () => {
  it("keeps locked prefix stable when regenSalt changes", () => {
    const locks = locksFromLayers({ form: "" });
    const a = makeComposeRng(7, { locks, regenSalt: "" });
    const b = makeComposeRng(7, { locks, regenSalt: "r2" });
    assert.equal(a("form/family/stick"), b("form/family/stick"));
    assert.notEqual(a("harmony/x"), b("harmony/x"));
    assert.equal(
      b("harmony/x"),
      rng(7, withSalt("harmony/x", "r2")),
    );
  });
});

describe("compose lock-regenerate", () => {
  it("locked form sections stay when regenSalt bumps", () => {
    const locks = locksFromLayers({ form: "" });
    const a = compose(base({ locks, regenSalt: "" }));
    const b = compose(base({ locks, regenSalt: "regen-9" }));
    assert.deepEqual(
      a.score.sections.map((s) => s.kind),
      b.score.sections.map((s) => s.kind),
    );
    assert.deepEqual(
      a.score.sections.map((s) => s.bars),
      b.score.sections.map((s) => s.bars),
    );
  });

  it("unlocked drums change when regenSalt bumps", () => {
    const locks = locksFromLayers({ form: "", harmony: "" });
    const a = compose(base({ locks, regenSalt: "" }));
    const b = compose(base({ locks, regenSalt: "drums-2" }));
    const kickA = a.score.parts.find((p) => p.role === "kick");
    const kickB = b.score.parts.find((p) => p.role === "kick");
    assert.ok(kickA && kickB);
    // Same form+harmony lock → different drum planning salt → different events.
    assert.notDeepEqual(
      kickA!.events.map((e) => e.tick),
      kickB!.events.map((e) => e.tick),
    );
  });
});
