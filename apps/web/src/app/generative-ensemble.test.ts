import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensemble,
  extractSharedOnsets,
  type EnsembleHit,
} from "./generative-ensemble.js";
import { mulberry32 } from "./generative.js";

describe("planEnsemble", () => {
  it("does not leave arp independent when callResponse is on with lead+arp", () => {
    const rnd = mulberry32(42);
    const plan = ensemble.plan({
      roles: ["kick", "lead", "arp", "bass"],
      rnd,
      callResponseMode: "on",
      energy: 0.6,
      sparse: false,
    });
    const arpIdx = 2;
    assert.notEqual(plan.relationByTrack[arpIdx], "independent");
    assert.equal(plan.primaryLeadTrack, 1);
    assert.ok(plan.leadCell && plan.leadCell.length > 0);
    assert.ok(plan.responseCell && plan.responseCell.length > 0);
    assert.ok(plan.sharedOnsets.length > 0);
  });

  it("assigns lock or kinship to bass/chord followers", () => {
    const rnd = mulberry32(7);
    const plan = ensemble.plan({
      roles: ["lead", "bass", "chord"],
      rnd,
      callResponseMode: "off",
      energy: 0.5,
      sparse: false,
    });
    assert.equal(plan.relationByTrack[0], "independent");
    for (const i of [1, 2]) {
      const r = plan.relationByTrack[i]!;
      assert.ok(r === "lock" || r === "kinship" || r === "respond");
    }
  });
});

describe("applyLock", () => {
  it("keeps follower onsets on the shared skeleton", () => {
    const cell = [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 2, sixteenths: 4 },
      { degree: 4, sixteenths: 4, accent: true },
      { degree: 0, sixteenths: 4 },
    ] as const;
    const shared = extractSharedOnsets(cell);
    const ppq = 96;
    const beatsPerBar = 4;
    const ticksPer16 = ppq / 4;
    // Scatter hits: some on skeleton, some off
    const hits: EnsembleHit[] = [
      { tickInBar: 0, gainDb: 0, accent: true, melodyDegree: 0 },
      { tickInBar: Math.round(2 * ticksPer16), gainDb: -1, accent: false },
      { tickInBar: Math.round(4 * ticksPer16), gainDb: -1, accent: false },
      { tickInBar: Math.round(8 * ticksPer16), gainDb: 0, accent: true },
      { tickInBar: Math.round(10 * ticksPer16), gainDb: -2, accent: false },
    ];
    const locked = ensemble.applyLock(hits, shared, beatsPerBar, ppq);
    const tol = Math.max(2, Math.floor(ppq / 8));
    const skeleton = shared.map((s) => Math.round(s * ticksPer16));
    for (const h of locked) {
      const ok = skeleton.some((t) => Math.abs(h.tickInBar - t) <= tol);
      assert.ok(ok, `tick ${h.tickInBar} not near skeleton ${skeleton}`);
    }
  });
});

describe("applyRespond", () => {
  it("places response density on the second half-bar", () => {
    const response = [
      { degree: 5, sixteenths: 4 },
      { degree: 4, sixteenths: 4 },
      { degree: 0, sixteenths: 4, accent: true },
    ] as const;
    const ppq = 96;
    const beatsPerBar = 4;
    const half = Math.floor((beatsPerBar * ppq) / 2);
    const hits = ensemble.applyRespond(response, beatsPerBar, ppq);
    assert.ok(hits.length > 0);
    const firstHalf = hits.filter((h) => h.tickInBar < half).length;
    const secondHalf = hits.filter((h) => h.tickInBar >= half).length;
    assert.equal(firstHalf, 0);
    assert.ok(secondHalf > 0);
  });
});
