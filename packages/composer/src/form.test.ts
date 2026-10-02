import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCarrure,
  energyAt,
  fitForm,
  pickFormFamily,
} from "./form.js";
import { makeRng } from "./rng.js";
import type { FormFamily, Section } from "./types.js";

describe("form carrure", () => {
  const families: FormFamily[] = [
    "verse-chorus",
    "aaba",
    "build-drop",
    "arch",
    "rondo",
    "loop-evolve",
  ];

  for (const family of families) {
    for (const bars of [16, 32, 48, 64]) {
      it(`${family} @ ${bars} → carrure + contiguous`, () => {
        const plan = fitForm({
          targetBars: bars,
          family,
          energyShape: "arch",
          energyBias: 0.5,
          rng: makeRng(bars * 17 + family.length),
        });
        assert.ok(assertCarrure(plan.sections), plan.warnings.join(";"));
        assert.ok(plan.sections.length >= 1);
        let cursor = 0;
        for (const s of plan.sections) {
          assert.equal(s.startBar, cursor);
          cursor += s.bars;
        }
        assert.equal(plan.totalBars, cursor);
        assert.ok(Math.abs(plan.totalBars - bars) <= 16);
      });
    }
  }

  it("total ≤ 8 may use 2-bar sections", () => {
    const plan = fitForm({
      targetBars: 8,
      family: "loop-evolve",
      energyShape: "plateau",
      energyBias: 0.5,
      rng: makeRng(3),
    });
    assert.ok(assertCarrure(plan.sections));
  });

  it("last chorus energy ≥ earlier choruses on rise", () => {
    const plan = fitForm({
      targetBars: 48,
      family: "verse-chorus",
      energyShape: "rise",
      energyBias: 0.6,
      rng: makeRng(99),
    });
    const choruses = plan.sections.filter((s) => s.kind === "chorus");
    if (choruses.length >= 2) {
      const last = choruses[choruses.length - 1]!;
      for (const c of choruses.slice(0, -1)) {
        assert.ok(last.energy >= c.energy - 1e-9);
      }
    }
  });

  it("pickFormFamily respects forced value", () => {
    const r = makeRng(1);
    assert.equal(pickFormFamily(r, "f", "aaba"), "aaba");
  });

  it("energyAt stays in 0..1", () => {
    const kinds: Section["kind"][] = [
      "intro",
      "verse",
      "chorus",
      "bridge",
      "outro",
    ];
    for (const shape of ["rise", "arch", "waves", "plateau"] as const) {
      for (let i = 0; i < kinds.length; i++) {
        const e = energyAt(shape, i, kinds.length, kinds[i]!);
        assert.ok(e >= 0 && e <= 1);
      }
    }
  });
});
